import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 主机的下载、文稿文件夹与系统语言（CLI 独立使用与发布 §5.2）。桌面端拉起 Runtime 时从系统取得，经 `BAOCUT_DOWNLOADS_DIR`、
 * `BAOCUT_DOCUMENTS_DIR`、`BAOCUT_SYSTEM_LANGUAGES` 传进来；别的方式拉起（CLI、Agent 宿主、登录项）时没有，这里按平台自己解析，
 * 补进环境，读它们的地方（`resolveDownloadsDirectory`、`defaultLegacyImportDirectory`、`processLanguageTags`）不用改。
 * 环境变量已经给了的不动：它们是覆盖（测试指到临时目录）。
 *
 * - macOS：文件夹就是 `~/Downloads`、`~/Documents`，与读的地方的缺省相同，不补；语言取全局偏好 `AppleLanguages`。
 * - Windows：一次 PowerShell 读注册表：`User Shell Folders` 的下载与文稿（展开环境变量；可能被 OneDrive 之类重定向），
 *   `International\User Profile` 的语言列表。输出按 UTF-8 写成 JSON，用户名里有非 ASCII 字符也不乱码。
 * - Linux：`xdg-user-dir DOWNLOAD` / `DOCUMENTS`（没配置时它报主目录，当作没有）；语言取 `LANGUAGE` 的列表。
 *
 * 解析不出来、命令失败或超时一律不补，退回读的地方的缺省，不阻断启动。解析出的文件夹不存在时也不补。
 */

export type CommandRunner = (command: string, args: readonly string[]) => Promise<string | null>;

export interface HostEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  userHome?: string;
  run?: CommandRunner;
  isDirectory?: (dir: string) => boolean;
}

const PROBE_TIMEOUT_MS = 5_000;

const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' }, (error, stdout) =>
      resolve(error ? null : stdout),
    );
  });

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** `defaults read -g AppleLanguages` 的输出：`(` 与 `)` 之间一行一个，带不带引号都有。 */
export function parseAppleLanguages(output: string): string[] {
  const body = /\(([\s\S]*)\)/.exec(output)?.[1] ?? '';
  return body
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/,$/, '').replace(/^"(.*)"$/, '$1').trim())
    .filter(Boolean);
}

/** Windows 读注册表的 PowerShell：下载（已知文件夹 GUID）、文稿（`Personal`）与语言列表，写成一行 JSON。 */
export const WINDOWS_PROBE = [
  '$ErrorActionPreference = "SilentlyContinue"',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  "$f = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'",
  "$l = Get-ItemProperty 'HKCU:\\Control Panel\\International\\User Profile'",
  "@{ downloads = $f.'{374DE290-123F-4565-9164-39C4925E467B}'; documents = $f.Personal; languages = @($l.Languages) } | ConvertTo-Json -Compress",
].join('; ');

export interface WindowsProbe {
  downloads: string | null;
  documents: string | null;
  languages: string[];
}

/** `WINDOWS_PROBE` 的输出。认不出时都是空的。 */
export function parseWindowsProbe(output: string): WindowsProbe {
  try {
    const value = JSON.parse(output.trim().replace(/^\uFEFF/, '')) as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const list = Array.isArray(value.languages) ? value.languages : [value.languages];
    return {
      downloads: text(value.downloads),
      documents: text(value.documents),
      languages: list.map(text).filter((tag): tag is string => tag !== null),
    };
  } catch {
    return { downloads: null, documents: null, languages: [] };
  }
}

/** `LANGUAGE` 是冒号分隔的 POSIX 语言名（`zh_CN:en`）。 */
export function parseLanguageList(value: string | undefined): string[] {
  return (value ?? '')
    .split(':')
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== 'C' && tag !== 'POSIX');
}

/** 要补进环境的变量。已经给了的不在其中。 */
export async function hostEnvironment(options: HostEnvironmentOptions = {}): Promise<Record<string, string>> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const userHome = options.userHome ?? os.homedir();
  const run = options.run ?? runCommand;
  const directory = options.isDirectory ?? isDirectory;
  const want = {
    downloads: !env.BAOCUT_DOWNLOADS_DIR,
    documents: !env.BAOCUT_DOCUMENTS_DIR,
    languages: !env.BAOCUT_SYSTEM_LANGUAGES,
  };
  const found: { downloads?: string | null; documents?: string | null; languages?: string[] } = {};

  if (platform === 'darwin') {
    if (want.languages) found.languages = parseAppleLanguages((await run('defaults', ['read', '-g', 'AppleLanguages'])) ?? '');
  } else if (platform === 'win32') {
    if (want.downloads || want.documents || want.languages) {
      const powershell = path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      Object.assign(found, parseWindowsProbe((await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROBE])) ?? ''));
    }
  } else {
    const xdg = async (name: string) => {
      const dir = (await run('xdg-user-dir', [name]))?.trim() ?? '';
      return dir && path.resolve(dir) !== path.resolve(userHome) ? dir : null;
    };
    const [downloads, documents] = await Promise.all([want.downloads ? xdg('DOWNLOAD') : null, want.documents ? xdg('DOCUMENTS') : null]);
    Object.assign(found, { downloads, documents, languages: parseLanguageList(env.LANGUAGE) });
  }

  const result: Record<string, string> = {};
  const absolute = (dir: string) => (platform === 'win32' ? path.win32.isAbsolute(dir) : path.isAbsolute(dir));
  if (want.downloads && found.downloads && absolute(found.downloads) && directory(found.downloads)) result.BAOCUT_DOWNLOADS_DIR = found.downloads;
  if (want.documents && found.documents && absolute(found.documents) && directory(found.documents)) result.BAOCUT_DOCUMENTS_DIR = found.documents;
  if (want.languages && found.languages?.length) result.BAOCUT_SYSTEM_LANGUAGES = found.languages.join(',');
  return result;
}
