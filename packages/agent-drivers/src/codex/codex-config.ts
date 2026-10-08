import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Codex 的配置目录：`CODEX_HOME`，没设时是 `~/.codex`。先看给 codex 子进程的环境（含登录 shell 里设的），再看本进程的。
 */
export function codexHome(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

/**
 * 不传模型时 codex 会用哪个：`config.toml` 顶层的 `model = "..."`。读不到、没写为 null。
 * 只读这一个键，不读凭据；不引入 TOML 依赖，只认第一个表头（`[...]`）之前的 `model = "..."` 或 `'...'`。
 * 不跟 `profile = "..."` 去找 `[profiles.<名>]` 里的覆盖：这种配置下报的可能不是实际用的模型。
 */
export async function readCodexConfigModel(env: NodeJS.ProcessEnv): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(path.join(codexHome(env), 'config.toml'), 'utf8');
  } catch {
    return null;
  }
  return parseTopLevelModel(text);
}

export function parseTopLevelModel(toml: string): string | null {
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) return null;
    const match = /^model\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (match) {
      const value = match[1] !== undefined ? match[1].replace(/\\(.)/g, '$1') : (match[2] ?? '');
      return value.trim() || null;
    }
  }
  return null;
}
