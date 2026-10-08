import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { agentEnv, findOnPath, isExecutable, pickNewest } from '../login-shell.ts';

const run = promisify(execFile);

export interface PiInstall {
  command: string;
  version: string | null;
  env: NodeJS.ProcessEnv;
}

/** 覆盖可执行文件位置的环境变量。 */
export const PI_PATH_VARIABLE = 'BAOCUT_PI_PATH';

/**
 * 每次起 pi 都带上：不去网上查新版本（探测与会话都不需要，省一次网络往返）。旧版不认识这个变量，照样能跑。
 */
export const PI_ENV: Record<string, string> = { PI_SKIP_VERSION_CHECK: '1' };

let located: { at: number; result: Promise<PiInstall | null> } | null = null;

/**
 * `BAOCUT_PI_PATH` 优先；否则在登录 shell 的 PATH 与常见安装位置（`~/.local/bin`、Homebrew、`/usr/local/bin`、nvm 各版本的 bin）
 * 里取版本最新的一个。结果缓存 30 秒，避免每次开会话都跑一遍 `--version`。
 */
export function locatePi(): Promise<PiInstall | null> {
  if (located && Date.now() - located.at <= 30_000) return located.result;
  located = { at: Date.now(), result: findPi() };
  return located.result;
}

async function findPi(): Promise<PiInstall | null> {
  const env = await agentEnv();
  const override = process.env[PI_PATH_VARIABLE];
  if (override) return { command: override, version: await readPiVersion(override, env), env };
  const candidates: string[] = [];
  const onPath = await findOnPath(process.platform === 'win32' ? 'pi.cmd' : 'pi', env.PATH ?? '');
  if (onPath) candidates.push(onPath);
  for (const file of await knownLocations()) {
    if (await isExecutable(file)) candidates.push(file);
  }
  return pickNewest(candidates, async (command) => ({ command, version: await readPiVersion(command, env), env }));
}

/** npm 全局安装常见的落点。nvm 每个 Node 版本一套全局目录，逐个列出来。 */
async function knownLocations(): Promise<string[]> {
  const home = os.homedir();
  const out = [path.join(home, '.local/bin/pi'), '/opt/homebrew/bin/pi', '/usr/local/bin/pi'];
  const nvm = path.join(process.env.NVM_DIR || path.join(home, '.nvm'), 'versions/node');
  const versions = await fs.readdir(nvm).catch(() => [] as string[]);
  for (const version of versions) out.push(path.join(nvm, version, 'bin/pi'));
  return out;
}

/** 用户手动指定的可执行文件：只认这一个，不再到别处找。不存在或不可执行时为 null。 */
export async function piAt(command: string): Promise<PiInstall | null> {
  if (!(await isExecutable(command))) return null;
  const env = await agentEnv();
  return { command, version: await readPiVersion(command, env), env };
}

/** `pi --version` 输出里的版本号（实测 1.0.4 只打印 `1.0.4`）。 */
export function parsePiVersion(output: string): string | null {
  return /(\d+(?:\.\d+)+)/.exec(output)?.[1] ?? null;
}

async function readPiVersion(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(command, ['--version'], { env: { ...env, ...PI_ENV }, timeout: 10_000 });
    return parsePiVersion(stdout) ?? parsePiVersion(stderr);
  } catch {
    return null;
  }
}
