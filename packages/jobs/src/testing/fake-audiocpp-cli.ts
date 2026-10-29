/**
 * 假的 `audiocpp_cli`（内置 audio.cpp 引擎的命令行）：测试用 `writeFakeAudioCpp` 生成的可执行包装调用它，包装设置
 * `FAKE_AUDIOCPP_CONTROL` 与 `FAKE_AUDIOCPP_RECORD`（与 `fake-audiocpp-server.ts` 共用）。
 *
 * - `--version`：打印版本。
 * - `--task sep`（audio.cpp 的人声与背景分离）：读 `--audio`（只收 44.1 kHz 立体声 32 位浮点 WAV，与真引擎一样不重采样），
 *   每一轨写成输入乘一个系数的 32 位浮点 WAV（`htdemucs`：人声 1、鼓 / 贝斯 / 其他各 0.1；别的族：人声 1、伴奏 0.25；人声比背景响，模型检查能过），
 *   追加一行 `{ pid, kind: 'sep', args }` 到记录。控制里的 `sepSkip`（不写这一轨）、`sepFail`（以错误退出）、`sepHang`（挂起）。
 * - 别的调用：失败（这里不跑别的任务）。
 */
import fs from 'node:fs';
import path from 'node:path';

interface Control {
  sepSkip?: string;
  sepFail?: string;
  sepHang?: boolean;
}

const args = process.argv.slice(2);
if (args.includes('--version')) {
  fs.writeSync(1, 'audio.cpp 0.9.3\n');
  process.exit(0);
}
const flag = (name: string): string | null => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
};
if (flag('--task') !== 'sep') {
  fs.writeSync(2, 'fake audiocpp_cli only runs --task sep\n');
  process.exit(2);
}

const control = (): Control => {
  try {
    return JSON.parse(fs.readFileSync(process.env.FAKE_AUDIOCPP_CONTROL ?? '', 'utf8')) as Control;
  } catch {
    return {};
  }
};
const recordFile = process.env.FAKE_AUDIOCPP_RECORD;
if (recordFile) fs.appendFileSync(recordFile, JSON.stringify({ pid: process.pid, kind: 'sep', args }) + '\n');
const options = control();
if (options.sepFail) {
  fs.writeSync(2, `error: ${options.sepFail}\n`);
  process.exit(3);
}
if (options.sepHang) {
  setInterval(() => {}, 1000);
} else {
  separate();
}

function separate(): void {
  const input = fs.readFileSync(flag('--audio')!);
  let offset = 12;
  let fmt: { channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= input.length) {
    const id = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    if (id === 'fmt ') fmt = { channels: input.readUInt16LE(offset + 10), rate: input.readUInt32LE(offset + 12), bits: input.readUInt16LE(offset + 22) };
    if (id === 'data') {
      data = input.subarray(offset + 8, offset + 8 + size);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.rate !== 44_100 || fmt.channels !== 2 || fmt.bits !== 32) {
    fs.writeSync(2, `error: input must be 44.1 kHz stereo float32 WAV, got ${JSON.stringify(fmt)}\n`);
    process.exit(2);
  }
  const stems: Record<string, number> =
    flag('--family') === 'htdemucs' ? { vocals: 1, drums: 0.1, bass: 0.1, other: 0.1 } : { vocals: 1, instrumental: 0.25 };
  const out = flag('--out-dir')!;
  for (const [name, gain] of Object.entries(stems)) {
    if (options.sepSkip === name) continue;
    const body = Buffer.alloc(data.length);
    for (let i = 0; i + 4 <= data.length; i += 4) body.writeFloatLE(data.readFloatLE(i) * gain, i);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + body.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(3, 20);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(44_100, 24);
    header.writeUInt32LE(44_100 * 8, 28);
    header.writeUInt16LE(8, 32);
    header.writeUInt16LE(32, 34);
    header.write('data', 36);
    header.writeUInt32LE(body.length, 40);
    fs.writeFileSync(path.join(out, `${name}.wav`), Buffer.concat([header, body]));
  }
  fs.writeSync(1, `metrics.wall_ms=1\nmetrics.audio_duration_ms=${Math.round((data.length / 8 / 44_100) * 1000)}\n`);
}
