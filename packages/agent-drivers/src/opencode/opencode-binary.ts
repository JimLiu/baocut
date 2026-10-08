/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/opencode/runtime-client.ts 的 VERSION_PATTERN 与主版本判定。
 * 改成 BaoCut 的安装查找（同 acp/acp-binary.ts：环境变量覆盖、登录 shell 的 PATH、已知位置里取版本最新的一个）。
 */
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { agentEnv, findOnPath, isExecutable, pickNewest } from '../login-shell.ts';
import { OPENCODE_PATH_VARIABLE, OPENCODE_PRESET } from './opencode-preset.ts';

const run = promisify(execFile);

export interface OpenCodeInstall {
  command: string;
  version: string | null;
  env: NodeJS.ProcessEnv;
}

let located: { at: number; result: Promise<OpenCodeInstall | null> } | null = null;

/**
 * `BAOCUT_OPENCODE_PATH` 优先；否则在登录 shell 的 PATH（`opencode` 与 `opencode2`）与已知安装位置里取版本最新的一个。
 * 1.x 与 2.x 同时装着时取 2.x。结果缓存 30 秒。
 */
export function locateOpenCode(): Promise<OpenCodeInstall | null> {
  if (located && Date.now() - located.at <= 30_000) return located.result;
  located = { at: Date.now(), result: findOpenCode() };
  return located.result;
}

async function findOpenCode(): Promise<OpenCodeInstall | null> {
  const env = await agentEnv();
  const override = process.env[OPENCODE_PATH_VARIABLE];
  if (override) return { command: override, version: await readOpenCodeVersion(override, env), env };

  const candidates: string[] = [];
  const exe = process.platform === 'win32' ? '.exe' : '';
  for (const name of [OPENCODE_PRESET.command, ...OPENCODE_PRESET.commandAliases]) {
    const onPath = await findOnPath(`${name}${exe}`, env.PATH ?? '');
    if (onPath) candidates.push(onPath);
  }
  for (const location of OPENCODE_PRESET.knownLocations) {
    const file = location.startsWith('~/') ? path.join(os.homedir(), location.slice(2)) : location;
    if (await isExecutable(file)) candidates.push(file);
  }
  return pickNewest(candidates, async (command) => ({ command, version: await readOpenCodeVersion(command, env), env }));
}

/** 用户手动指定的可执行文件：只认这一个。不存在或不可执行时为 null。 */
export async function openCodeAt(command: string): Promise<OpenCodeInstall | null> {
  if (!(await isExecutable(command))) return null;
  const env = await agentEnv();
  return { command, version: await readOpenCodeVersion(command, env), env };
}

const VERSION_PATTERN = /^(?:opencode\s+)?v?(\d+\.\d+\.\d+)(?:[-+][\w.-]+)?$/i;

/** `opencode --version` 的输出：2.x 是 `opencode v2.0.24`，1.x 是 `1.18.34`。认不出时为 null。 */
export function parseOpenCodeVersion(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = VERSION_PATTERN.exec(line.trim());
    if (match) return match[1]!;
  }
  return null;
}

/** 主版本号；读不出时为 null。 */
export function majorVersion(version: string): number | null {
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

async function readOpenCodeVersion(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(command, ['--version'], { env, timeout: 10_000 });
    return parseOpenCodeVersion(stdout) ?? parseOpenCodeVersion(stderr);
  } catch {
    return null;
  }
}
