import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DriversCodex } from '@baocut/protocol/messages/agent-drivers';
import { nodeCliCommand, resolveCmdShim } from '../cli-command.ts';
import type { DriverText } from '../driver-text.ts';
import { agentEnv, findOnPath, isExecutable, pickNewest } from '../login-shell.ts';

const run = promisify(execFile);

export interface CodexInstall {
  command: string;
  version: string | null;
  env: NodeJS.ProcessEnv;
}

/**
 * 随桌面应用一起安装的 codex。`~/.codex/config.toml` 是所有客户端共用的，
 * 较新的客户端可能写入旧 CLI 不认识的模型，所以 PATH 上的 codex 不一定能用。
 */
const BUNDLED_CODEX = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  '/Applications/Codex.app/Contents/Resources/codex',
];

/**
 * 在 PATH 上找的文件名，与另外再看的位置。
 * - macOS：随桌面应用安装的 codex（`/Applications` 与 `~/Applications`）。
 * - Windows：独立的 `codex.exe`；npm 全局安装的批处理垫片 `%APPDATA%\npm\codex.cmd`（见 `resolveCmdShim`）。未在 Windows 上验证。
 */
export function codexSearch(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): { names: string[]; locations: string[] } {
  if (platform === 'win32') {
    const win = path.win32;
    return { names: ['codex.exe', 'codex.cmd'], locations: [win.join(env.APPDATA || win.join(home, 'AppData', 'Roaming'), 'npm', 'codex.cmd')] };
  }
  const locations = platform === 'darwin' ? BUNDLED_CODEX.flatMap((file) => [file, path.join(home, file)]) : [];
  return { names: ['codex'], locations };
}

let located: { at: number; result: Promise<CodexInstall | null> } | null = null;

/**
 * `BAOCUT_CODEX_PATH` 优先；否则在登录 shell 的 PATH 与已知安装位置里取版本最新的一个。
 * 结果缓存 30 秒，避免每次开会话都跑一遍 `--version`。
 */
export function locateCodex(): Promise<CodexInstall | null> {
  if (!located || Date.now() - located.at > 30_000) {
    located = { at: Date.now(), result: findCodex() };
  }
  return located.result;
}

async function findCodex(): Promise<CodexInstall | null> {
  const env = await agentEnv();
  const override = process.env.BAOCUT_CODEX_PATH;
  if (override) return inspectCodex(override, env);

  const search = codexSearch(process.platform, env, os.homedir());
  const candidates: string[] = [];
  for (const name of search.names) {
    const onPath = await findOnPath(name, env.PATH ?? '');
    if (onPath) candidates.push(onPath);
  }
  for (const file of search.locations) {
    if (await isExecutable(file)) candidates.push(file);
  }
  const resolved = process.platform === 'win32' ? await Promise.all(candidates.map(resolveCmdShim)) : candidates;
  return pickNewest(resolved, (command) => inspectCodex(command, env));
}

/** 用户手动指定的 codex：只认这一个，不再到别处找。不存在或不可执行时为 null。 */
export async function codexAt(command: string): Promise<CodexInstall | null> {
  if (!(await isExecutable(command))) return null;
  return inspectCodex(command, await agentEnv());
}

/**
 * Windows 上 npm 装的 `codex.cmd` 不能不经 shell 直接起，换成垫片指向的 `codex.js`（之后交给 node，见 `codexCommand`）。
 * 跑一次 `--version`，读不出版本时 version 为 null（探测报「出错」）。
 */
async function inspectCodex(command: string, env: NodeJS.ProcessEnv): Promise<CodexInstall> {
  const file = process.platform === 'win32' ? await resolveCmdShim(command) : command;
  return { command: file, version: await readCodexVersion(file, env), env };
}

/** 起 codex 子命令（`--version`、`login status`、`app-server`）的程序与参数：`.js` 入口交给 node。 */
export function codexCommand(command: string, args: string[]): { file: string; args: string[] } {
  const exec = nodeCliCommand(command);
  return { file: exec.file, args: [...exec.args, ...args] };
}

async function readCodexVersion(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const exec = codexCommand(command, ['--version']);
    const { stdout } = await run(exec.file, exec.args, { env, timeout: 10_000 });
    return stdout.trim().replace(/^codex-cli\s+/, '') || null;
  } catch {
    return null;
  }
}

/**
 * `codex login status` 的原文（「Logged in using ChatGPT」「Logged in using an API key - sk-…」）→ 设置页与输入区脚注上的账号描述。
 * 原文里可能带打码的密钥，不往外传；认不出的写成「Codex 账号」。
 */
export function codexAccount(status: string): DriverText {
  const method = /Logged in using (.+)/i.exec(status)?.[1]?.trim().toLowerCase() ?? '';
  if (method.startsWith('chatgpt')) return DriversCodex.chatgptAccount();
  if (method.startsWith('amazon bedrock')) return 'Amazon Bedrock';
  if (method.startsWith('an api key')) return DriversCodex.apiKey();
  if (method.includes('access token')) return DriversCodex.accessToken();
  if (method.startsWith('workload identity')) return DriversCodex.workloadIdentity();
  return DriversCodex.codexAccount();
}

/** `codexAccount` 的文字（当前语言）。 */
export function describeCodexAccount(status: string): string {
  return String(codexAccount(status));
}

/**
 * `codex login status` 的结论。`failed` 是命令本身没跑成，说明不了登没登录：用法错误（退出码 2，例如包装脚本在参数后面
 * 多加了 `--yolo`）、包装脚本里找不到 codex（127）、超时等。
 */
export interface CodexLogin {
  status: 'signed-in' | 'signed-out' | 'failed';
  detail: string;
}

/** 退出码 0 是已登录，1 是未登录（`Not logged in`，对照 codex-cli 0.166.0），别的都算没查成。 */
export async function readCodexLogin(install: CodexInstall): Promise<CodexLogin> {
  try {
    const exec = codexCommand(install.command, ['login', 'status']);
    const { stdout, stderr } = await run(exec.file, exec.args, {
      env: install.env,
      timeout: 10_000,
    });
    return { status: 'signed-in', detail: (stdout || stderr).trim() };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string; message: string };
    return { status: e.code === 1 ? 'signed-out' : 'failed', detail: (e.stderr || e.stdout || e.message).trim() };
  }
}
