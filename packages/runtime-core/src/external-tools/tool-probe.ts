import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Localized } from '@baocut/protocol';
import { RcExternalTools } from '@baocut/protocol/messages/runtime-core';

/**
 * 探测外部工具（架构设计 §12.9）：在给定的搜索路径里找可执行文件，执行一次打印版本的参数。只在本机执行，不联网；
 * 不经 shell，有时限，超时杀掉。
 */

const PROBE_TIMEOUT_MS = 15_000;
const OUTPUT_LIMIT = 8_000;

/** Windows 上 `PATHEXT` 没有设置时的取值。 */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * 在 `searchPath`（PATH 的写法）里找 `command`；找不到时 null。
 *
 * Windows 上和命令行一样按 `PATHEXT` 的顺序补扩展名（`yt-dlp` 先找 `yt-dlp.com`、`yt-dlp.exe`，再找 `.bat`、`.cmd`），
 * 最后才是原名；已经带扩展名的只找原名。找到的可能是批处理脚本，能不能执行由调用方判断（见 `windowsScriptKind`）。
 */
export async function findOnPath(
  command: string,
  searchPath: string,
  platform: NodeJS.Platform = process.platform,
  pathExt: string | null = null,
): Promise<string | null> {
  const names = platform === 'win32' && !/\.[^.\\/]+$/.test(command) ? [...pathExtensions(pathExt).map((ext) => `${command}${ext}`), command] : [command];
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const name of names) {
      const file = path.join(dir, name);
      if (await isExecutableFile(file)) return file;
    }
  }
  return null;
}

/** `PATHEXT` 拆成小写的扩展名列表（去掉空的、不以点开头的与重复的）。 */
export function pathExtensions(pathExt: string | null | undefined): string[] {
  const list = (pathExt || DEFAULT_PATHEXT)
    .split(';')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => /^\.[^.\\/]+$/.test(ext));
  return [...new Set(list)];
}

/** 不区分大小写地取环境变量（Windows 上键名不分大小写，展开后的对象里可能是 `Path`、`PathExt`）。 */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (env[name] !== undefined) return env[name];
  const upper = name.toUpperCase();
  const key = Object.keys(env).find((k) => k.toUpperCase() === upper);
  return key === undefined ? undefined : env[key];
}

/**
 * Windows 上不经 shell 不能直接执行的文件：`.cmd`、`.bat` 要 `cmd.exe` 来跑（Node 不经 shell 启动会报 EINVAL），
 * 其他非 `.exe`、`.com` 的（`.ps1`、`.py`、没有扩展名的）也不是 Windows 程序。能直接执行时 null。
 */
export function windowsScriptKind(file: string): 'batch' | 'other' | null {
  const ext = path.win32.extname(file).toLowerCase();
  if (ext === '.exe' || ext === '.com') return null;
  return ext === '.cmd' || ext === '.bat' ? 'batch' : 'other';
}

/** 是一个能执行的普通文件（跟随符号链接）。 */
export async function isExecutableFile(file: string): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) return false;
  return fs.access(file, constants.X_OK).then(
    () => true,
    () => false,
  );
}

export type ProbeOutcome = { ok: true; output: string } | { ok: false; reason: Localized };

/** 执行 `file args…`，返回标准输出（不够时连同标准错误）。非零退出、超时、启动失败都是 `ok: false` 并说明原因。 */
export async function runVersionProbe(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeOutcome> {
  return await new Promise<ProbeOutcome>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({ ok: false, reason: RcExternalTools.probeCannotStart({ error: String(error) }) });
      return;
    }
    let output = '';
    let errors = '';
    let settled = false;
    const finish = (outcome: ProbeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ ok: false, reason: RcExternalTools.probeTimeout({ command: args.join(' '), seconds: Math.round(timeoutMs / 1000) }) });
    }, timeoutMs);
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      output = (output + chunk).slice(0, OUTPUT_LIMIT);
    });
    child.stderr!.on('data', (chunk: string) => {
      errors = (errors + chunk).slice(-OUTPUT_LIMIT);
    });
    child.on('error', (error: NodeJS.ErrnoException) => finish({ ok: false, reason: RcExternalTools.probeCannotStartCode({ code: error.code ?? error.message }) }));
    child.on('close', (code, signal) => {
      if (code === 0) finish({ ok: true, output: output || errors });
      else
        finish({
          ok: false,
          reason: RcExternalTools.probeExited({
            code: String(code ?? signal),
            detail: errors.trim() ? errors.trim().split('\n').at(-1)!.slice(0, 200) : '',
          }),
        });
    });
  });
}
