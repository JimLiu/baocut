import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { agentEnv, findOnPath, isExecutable, pickNewest } from '../login-shell.ts';
import { resolveCliCommand } from '../cli-command.ts';
import type { AcpPreset } from './acp-presets.ts';

const run = promisify(execFile);

export interface AcpInstall {
  command: string;
  version: string | null;
  env: NodeJS.ProcessEnv;
}

const located = new Map<string, { at: number; result: Promise<AcpInstall | null> }>();

const LOCALAPPDATA = '%LOCALAPPDATA%/';

/**
 * Windows 同时支持独立 exe 与 npm cmd shim；macOS / Linux 使用原命令与预设安装位置。
 * 已知位置里 `~/` 开头的相对于用户主目录；`%LOCALAPPDATA%/` 开头的只在 Windows 上用（没有这个变量时取 `~\AppData\Local`）。
 */
export function acpSearch(preset: Pick<AcpPreset, 'command' | 'knownLocations'>, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): { names: string[]; locations: string[] } {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const locations = (preset.knownLocations ?? []).flatMap((file) => {
    if (file.startsWith(LOCALAPPDATA)) {
      if (platform !== 'win32') return [];
      return [path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), ...file.slice(LOCALAPPDATA.length).split('/'))];
    }
    return [file.startsWith('~/') ? paths.join(home, file.slice(2)) : file];
  });
  if (platform !== 'win32') return { names: [preset.command], locations };
  const win = path.win32;
  return {
    names: /\.(exe|cmd)$/i.test(preset.command) ? [preset.command] : [`${preset.command}.exe`, `${preset.command}.cmd`],
    locations: [
      win.join(home, '.local', 'bin', `${preset.command}.exe`),
      win.join(env.APPDATA || win.join(home, 'AppData', 'Roaming'), 'npm', `${preset.command}.cmd`),
      ...locations,
    ],
  };
}

/** 覆盖可执行文件位置的环境变量：`BAOCUT_GEMINI_PATH` 之类；id 里的连字符换成下划线（`my-agent` → `BAOCUT_MY_AGENT_PATH`）。 */
export function acpPathVariable(preset: Pick<AcpPreset, 'id'>): string {
  return `BAOCUT_${preset.id.toUpperCase().replace(/-/g, '_')}_PATH`;
}

/**
 * `BAOCUT_<ID>_PATH` 优先；否则在登录 shell 的 PATH 与已知安装位置里取版本最新的一个。
 * 结果按预设缓存 30 秒，避免每次开会话都跑一遍 `--version`。
 */
export function locateAcp(preset: AcpPreset): Promise<AcpInstall | null> {
  // 键里带上命令：用户移除再以同一个 id 添加另一个命令时不沿用旧结果。
  const key = `${preset.id}\0${preset.command}`;
  const hit = located.get(key);
  if (hit && Date.now() - hit.at <= 30_000) return hit.result;
  const entry = { at: Date.now(), result: findAcp(preset) };
  located.set(key, entry);
  return entry.result;
}

async function findAcp(preset: AcpPreset): Promise<AcpInstall | null> {
  const env = await agentEnv();
  // 没有最低版本的（用户添加的）不跑 `--version`：命令可能是 npx 这类，报的不是智能体的版本。
  const readVersion = preset.minVersion !== null;
  const version = (command: string) => (readVersion ? readAcpVersion(command, env) : Promise.resolve(null));
  const override = process.env[acpPathVariable(preset)];
  if (override) return { command: override, version: await version(override), env };
  // 绝对路径（用户添加时可以这样写）：只认这一个。
  if (path.isAbsolute(preset.command)) {
    return (await isExecutable(preset.command)) ? { command: preset.command, version: await version(preset.command), env } : null;
  }

  const candidates: string[] = [];
  const search = acpSearch(preset, process.platform, env, os.homedir());
  for (const name of search.names) {
    const onPath = await findOnPath(name, env.PATH ?? env.Path ?? '');
    if (onPath) candidates.push(onPath);
  }
  if (!readVersion) return candidates[0] ? { command: candidates[0], version: null, env } : null;
  for (const file of search.locations) {
    if (await isExecutable(file)) candidates.push(file);
  }
  return pickNewest(candidates, async (command) => ({ command, version: await readAcpVersion(command, env), env }));
}

/** 用户手动指定的可执行文件：只认这一个，不再到别处找。不存在或不可执行时为 null。 */
export async function acpAt(command: string, options: { readVersion?: boolean } = {}): Promise<AcpInstall | null> {
  if (!(await isExecutable(command))) return null;
  const env = await agentEnv();
  return { command, version: options.readVersion === false ? null : await readAcpVersion(command, env), env };
}

/** `--version` 输出里的第一个版本号（`0.46.0`、`2026.03.30-abc` 里的 `2026.03.30`、`kimi, version 0.11.0`）。 */
export function parseAcpVersion(output: string): string | null {
  return /(\d+(?:\.\d+)+)/.exec(output)?.[1] ?? null;
}

async function readAcpVersion(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const launch = await resolveCliCommand(command);
    const { stdout, stderr } = await run(launch.file, [...launch.args, '--version'], { env, timeout: 10_000 });
    return parseAcpVersion(stdout) ?? parseAcpVersion(stderr);
  } catch {
    return null;
  }
}
