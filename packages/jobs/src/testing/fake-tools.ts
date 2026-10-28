import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { YtDlpTool } from '../pipelines/yt-dlp.ts';

/** 假的 yt-dlp 脚本（`fake-yt-dlp.ts`）的绝对路径。 */
export const FAKE_YT_DLP = fileURLToPath(new URL('./fake-yt-dlp.ts', import.meta.url));

export interface FakeYtDlp {
  /** 可执行的包装（`<dir>/yt-dlp`）。 */
  command: string;
  /** 直接用当前 Node 运行，供跨平台的进程测试使用（Windows 不能直接启动 sh 包装）。 */
  nodeTool: YtDlpTool;
  /** 每次调用追加一行 `{ argv }`。 */
  log: string;
  /** 读出记下的调用。 */
  calls(): Promise<Array<{ argv?: string[]; resumedFrom?: number }>>;
}

/**
 * 在 `dir` 里写一个名为 `yt-dlp` 的可执行包装：用当前的 Node 运行假脚本，日志写在 `dir` 里。
 * 包装里写的是绝对路径，不依赖 PATH：测试可以把 PATH 设成只含这个目录（或空目录），系统里真实的 yt-dlp 不会被用到。
 */
export async function writeFakeYtDlp(dir: string, options: { version?: string; name?: string } = {}): Promise<FakeYtDlp> {
  await fs.mkdir(dir, { recursive: true });
  const command = path.join(dir, options.name ?? 'yt-dlp');
  const log = path.join(dir, 'argv.log');
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const lines = [
    '#!/bin/sh',
    `export FAKE_YTDLP_LOG=${quote(log)}`,
    ...(options.version ? [`export FAKE_YTDLP_VERSION=${quote(options.version)}`] : []),
    `exec ${quote(process.execPath)} ${quote(FAKE_YT_DLP)} "$@"`,
    '',
  ];
  await fs.writeFile(command, lines.join('\n'), { mode: 0o755 });
  return {
    command,
    nodeTool: {
      command: process.execPath,
      args: [FAKE_YT_DLP],
      env: { FAKE_YTDLP_LOG: log, ...(options.version ? { FAKE_YTDLP_VERSION: options.version } : {}) },
    },
    log,
    async calls() {
      const text = await fs.readFile(log, 'utf8').catch(() => '');
      return text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { argv?: string[]; resumedFrom?: number });
    },
  };
}

/** 假的 `audiocpp_server` 脚本（`fake-audiocpp-server.ts`）的绝对路径。 */
export const FAKE_AUDIOCPP_SERVER = fileURLToPath(new URL('./fake-audiocpp-server.ts', import.meta.url));
/** 假的 audio.cpp 命令行引擎（`fake-audiocpp-cli.ts`，只跑人声与背景分离）的绝对路径。 */
export const FAKE_AUDIOCPP_CLI = fileURLToPath(new URL('./fake-audiocpp-cli.ts', import.meta.url));

/** 假 audio.cpp 服务收到的一次启动或一次合成请求（`fake-audiocpp-server.ts` 记下的一行），或命令行引擎的一次分离（`sep`）。 */
export interface FakeAudioCppRecord {
  kind: 'start' | 'request' | 'sep';
  pid: number;
  args?: string[];
  config?: { port: number; host: string; models: Array<Record<string, unknown>> } & Record<string, unknown>;
  body?: { model: string; input: string; voice_ref?: string; reference_text?: string; seed?: number; options: Record<string, unknown> };
  reference?: string | null;
}

/** 假 audio.cpp 服务的故障控制（每次启动与请求时重新读）。 */
export interface FakeAudioCppControl {
  startExit?: string;
  crash?: string;
  reject?: { status: number; message: string };
  slowMs?: number;
  silent?: boolean;
  notWav?: boolean;
  /** 命令行引擎分离时不写这一轨（如 `bass`）。 */
  sepSkip?: string;
  /** 命令行引擎分离时以错误退出，这是错误文字。 */
  sepFail?: string;
  /** 命令行引擎分离时挂起，直到被结束。 */
  sepHang?: boolean;
}

export interface FakeAudioCpp {
  /** 给 `BAOCUT_AUDIOCPP_CLI` 的路径（`<dir>/audiocpp_cli`）：服务取它同目录的 `audiocpp_server`；命令行引擎本身只认 `--version` 与 `--task sep`。 */
  cli: string;
  /** 改故障控制。 */
  control(value: FakeAudioCppControl): Promise<void>;
  /** 读出记下的启动与请求，可按种类过滤。 */
  recorded(kind?: FakeAudioCppRecord['kind']): Promise<FakeAudioCppRecord[]>;
}

/**
 * 在 `dir` 里写假的 audio.cpp：`audiocpp_server` 是用当前 Node 运行假脚本的 sh 包装，控制文件与记录也在 `dir` 里。
 * 包装是 sh 脚本，Windows 上不能直接启动。
 */
export async function writeFakeAudioCpp(dir: string): Promise<FakeAudioCpp> {
  await fs.mkdir(dir, { recursive: true });
  const controlFile = path.join(dir, 'audiocpp-control.json');
  const recordFile = path.join(dir, 'audiocpp-runs.jsonl');
  await fs.writeFile(controlFile, '{}');
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const lines = [
    '#!/bin/sh',
    `export FAKE_AUDIOCPP_CONTROL=${quote(controlFile)}`,
    `export FAKE_AUDIOCPP_RECORD=${quote(recordFile)}`,
    `exec ${quote(process.execPath)} ${quote(FAKE_AUDIOCPP_SERVER)} "$@"`,
    '',
  ];
  await fs.writeFile(path.join(dir, 'audiocpp_server'), lines.join('\n'), { mode: 0o755 });
  // 命令行引擎：让 Runtime 找到这个目录（`--version`），并跑 audio.cpp 的人声与背景分离（`--task sep`）；别的调用失败。
  const cli = path.join(dir, 'audiocpp_cli');
  const cliLines = [
    '#!/bin/sh',
    `export FAKE_AUDIOCPP_CONTROL=${quote(controlFile)}`,
    `export FAKE_AUDIOCPP_RECORD=${quote(recordFile)}`,
    `exec ${quote(process.execPath)} ${quote(FAKE_AUDIOCPP_CLI)} "$@"`,
    '',
  ];
  await fs.writeFile(cli, cliLines.join('\n'), { mode: 0o755 });
  return {
    cli,
    control: (value) => fs.writeFile(controlFile, JSON.stringify(value)),
    async recorded(kind) {
      return (await fs.readFile(recordFile, 'utf8').catch(() => ''))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FakeAudioCppRecord)
        .filter((r) => kind === undefined || r.kind === kind);
    },
  };
}
