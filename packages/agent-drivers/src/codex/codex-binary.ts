import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DriversCodex } from '@baocut/protocol/messages/agent-drivers';
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
  if (override) return { command: override, version: await readCodexVersion(override, env), env };

  const candidates: string[] = [];
  const onPath = await findOnPath(process.platform === 'win32' ? 'codex.exe' : 'codex', env.PATH ?? '');
  if (onPath) candidates.push(onPath);
  if (process.platform === 'darwin') {
    for (const file of BUNDLED_CODEX) {
      for (const candidate of [file, path.join(os.homedir(), file)]) {
        if (await isExecutable(candidate)) candidates.push(candidate);
      }
    }
  }
  return pickNewest(candidates, async (command) => ({ command, version: await readCodexVersion(command, env), env }));
}

/** 用户手动指定的 codex：只认这一个，不再到别处找。不存在或不可执行时为 null。 */
export async function codexAt(command: string): Promise<CodexInstall | null> {
  if (!(await isExecutable(command))) return null;
  const env = await agentEnv();
  return { command, version: await readCodexVersion(command, env), env };
}

async function readCodexVersion(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await run(command, ['--version'], { env, timeout: 10_000 });
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

/** `codex login status` 退出码为 0 表示已登录。 */
export async function readCodexLogin(install: CodexInstall): Promise<{ loggedIn: boolean; detail: string }> {
  try {
    const { stdout, stderr } = await run(install.command, ['login', 'status'], {
      env: install.env,
      timeout: 10_000,
    });
    return { loggedIn: true, detail: (stdout || stderr).trim() };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    return { loggedIn: false, detail: (e.stdout || e.stderr || e.message).trim() };
  }
}
