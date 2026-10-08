/**
 * 假的 yt-dlp：一个 Node 脚本，只认 BaoCut 传的那些参数，不联网。测试用 `writeFakeYtDlp` 生成的可执行包装调用它，
 * 包装设置 `FAKE_YTDLP_LOG`（每次调用追加一行 `{ argv }`）与可选的 `FAKE_YTDLP_VERSION`。
 *
 * 行为按链接的路径决定（链接是 `--` 之后的最后一个参数）：
 *
 * - `--version`：打印版本（默认 2026.07.04）。
 * - `--dump-single-json`：打印元数据；标题带空格、引号、斜杠与以 `-` 开头的部分，`webpage_url` 原样回显链接；带简介与几条脏的平台章节（乱序、负起点、同起点、空标题）。
 *   `/login` 要求登录、`/unsupported` 不支持、`/playlist` 是播放列表、`/down` 连不上网站。
 * - `/members`（解析与下载都一样）：只有 `--cookies-from-browser firefox` 登录着；`chrome` 读不到 Cookie 库，别的浏览器与匿名
 *   都要求登录。
 * - 下载（`-o <模板>`）：按 `--progress-template` 的格式打印真实的字节进度，写一个合法的 WAV（`media.wav`）；
 *   `--write-subs` 时按 `--sub-langs` 写 `media.<lang>.vtt`。
 *   `/nospace` 磁盘满；`/flaky` 第一次写一半 `.part` 后以网络错误退出，再次调用时接着 `.part` 写完；
 *   `/slow` 打印一行进度后开一个子进程，先把自己的 pid 写进 `<log>.pid`、再把子进程的写进 `<log>.child.pid`（都是原子写），一直不退出。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const log = process.env.FAKE_YTDLP_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ argv }) + '\n');

if (argv.includes('--version')) {
  fs.writeSync(1, `${process.env.FAKE_YTDLP_VERSION ?? '2026.07.04'}\n`);
  process.exit(0);
}

const separator = argv.indexOf('--');
const url = separator >= 0 ? argv[separator + 1] : undefined;
if (!url || separator !== argv.length - 2) fail('ERROR: fake yt-dlp: 链接应在 -- 之后，并且是最后一个参数', 2);
const route = new URL(url!).pathname;

const option = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 && index < separator ? argv[index + 1] : undefined;
};

if (route === '/login')
  fail(`ERROR: [generic] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.`);
if (route === '/unsupported') fail(`ERROR: Unsupported URL: ${url}`);
if (route === '/down') fail('ERROR: [generic] Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided, or not known>');
if (route === '/members') {
  const browser = option('--cookies-from-browser');
  if (browser === 'chrome') fail('ERROR: could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271 for more info');
  if (browser !== 'firefox') fail('ERROR: [generic] abc: This video is only available for registered users. Use --cookies-from-browser or --cookies for the authentication.');
}

if (argv.includes('--dump-single-json')) {
  if (route === '/playlist') {
    fs.writeSync(1, JSON.stringify({ _type: 'playlist', id: 'pl1', title: '列表', entries: [] }) + '\n');
    process.exit(0);
  }
  fs.writeSync(
    1,
    JSON.stringify({
      _type: 'video',
      id: 'abc123',
      title: `-rf "Fake clip": one/two  it's <ok>`,
      extractor_key: 'Generic',
      extractor: 'generic',
      uploader: 'Fake Uploader',
      upload_date: '20260102',
      duration: 1,
      webpage_url: url,
      description: '  A fake clip.\n\nChapters:\n0:00 Opening\n0:01 Ending  ',
      chapters: [
        { start_time: 0.5, end_time: 1, title: 'Second half' },
        { start_time: 0, end_time: 0.5, title: ' First half ' },
        { start_time: -1, end_time: 0, title: 'Negative' },
        { start_time: 0.5, end_time: 1, title: 'Duplicate start' },
        { start_time: 0.8, title: '   ' },
      ],
    }) + '\n',
  );
  process.exit(0);
}

const template = option('-o');
if (!template) fail('ERROR: fake yt-dlp: 没有 -o', 2);
if (route === '/nospace') fail('ERROR: unable to write data: [Errno 28] No space left on device');

const media = template!.replace('%(ext)s', 'wav');
const part = `${media}.part`;
const wav = silentWav(16_000);
const progress = (done: number) => {
  const template = option('--progress-template') ?? '';
  if (!template.startsWith('download:bcut-progress ')) return;
  fs.writeSync(1, `bcut-progress ${done} ${wav.length} NA\n`);
};

if (route === '/slow') {
  fs.writeFileSync(part, wav.subarray(0, 100));
  progress(100);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  if (log) {
    // 先写自己的、再写子进程的，每个都先写临时文件再改名：测试看到 `.child.pid` 时两个文件都已完整。
    writeAtomic(`${log}.pid`, String(process.pid));
    writeAtomic(`${log}.child.pid`, String(child.pid));
  }
  setInterval(() => {}, 1000);
} else if (route === '/flaky' && !fs.existsSync(part)) {
  const half = Math.floor(wav.length / 2);
  fs.writeFileSync(part, wav.subarray(0, half));
  progress(half);
  fail('ERROR: unable to download video data: <urlopen error [Errno 54] Connection reset by peer>');
} else {
  const start = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (start > 0 && log) fs.appendFileSync(log, JSON.stringify({ resumedFrom: start }) + '\n');
  const fd = fs.openSync(part, start > 0 ? 'a' : 'w');
  for (let offset = start; offset < wav.length; offset += 4000) {
    const end = Math.min(wav.length, offset + 4000);
    fs.writeSync(fd, wav.subarray(offset, end));
    progress(end);
  }
  fs.closeSync(fd);
  fs.renameSync(part, media);
  if (argv.includes('--write-subs')) {
    for (const lang of (option('--sub-langs') ?? '').split(',').filter(Boolean)) {
      const sub = template!.replace('%(ext)s', `${lang}.vtt`);
      fs.writeFileSync(sub, 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n你好\n');
    }
  }
  // 留一个不该被发布的临时文件：发布只认 media.<ext> 与 media.<lang>.<ext>。
  fs.writeFileSync(path.join(path.dirname(media), 'media.temp.json'), '{}');
  process.exit(0);
}

function writeAtomic(file: string, text: string): void {
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
}

function fail(message: string, code = 1): never {
  fs.writeSync(2, `${message}\n`);
  process.exit(code);
}

/** 8 kHz、单声道、16 位的静音 WAV：`bytes` 字节的数据。 */
function silentWav(bytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  return Buffer.concat([header, Buffer.alloc(bytes)]);
}
