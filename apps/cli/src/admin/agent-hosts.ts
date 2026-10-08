import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { M } from './agent-hosts-copy.ts';

/**
 * 外部 Agent 宿主（Agent 面设计 §6.2、§8.6）：`baocut skill install` 与 `baocut mcp install` 往哪里写、怎么写。每个宿主的位置与格式
 * 都按宿主自己的 CLI 实际核对过（写在各项旁边）；位置全部从这次调用的环境变量算（`HOME`、`CLAUDE_CONFIG_DIR`、`CODEX_HOME`），
 * 测试换成临时目录，不碰真实的配置。
 *
 * 写配置一律「读、改、原子替换」：只动 BaoCut 那一项，其余键原样保留；读不懂的配置（JSON 坏了）报错，不覆盖。
 */

export const AGENT_HOSTS = ['claude-code', 'codex', 'cursor', 'gemini'] as const;
export type AgentHost = (typeof AGENT_HOSTS)[number];

export const HOST_LABELS: Record<AgentHost, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
};

/** 宿主 MCP 配置里 BaoCut 那一项的名字。 */
export const MCP_ENTRY_NAME = 'baocut';
/** Claude Code 的令牌放在它 `settings.json` 的 `env` 里，MCP 配置的请求头引用它。 */
export const MCP_TOKEN_ENV = 'BAOCUT_MCP_TOKEN';

export function parseAgentHost(value: string | undefined): AgentHost {
  if (!value) throw new Error(M.missingAgent(AGENT_HOSTS));
  if (!(AGENT_HOSTS as readonly string[]).includes(value)) throw new Error(M.unknownAgent(value, AGENT_HOSTS));
  return value as AgentHost;
}

/** 用户主目录：`HOME`（Windows 是 `USERPROFILE`），都没有时取系统的。 */
export function userHome(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || os.homedir();
}

/** Claude Code 的配置目录：`CLAUDE_CONFIG_DIR`，默认 `~/.claude`。 */
function claudeConfigDir(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR || path.join(userHome(env), '.claude');
}

/** Codex 的目录：`CODEX_HOME`，默认 `~/.codex`。 */
function codexHome(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME || path.join(userHome(env), '.codex');
}

/**
 * 宿主的用户级 skills 目录（skill 装在其下的 `<id>/`）：
 * Claude Code `~/.claude/skills`（`CLAUDE_CONFIG_DIR` 下的 `skills`）；Codex `~/.codex/skills`（`CODEX_HOME`）；Cursor
 * `~/.cursor/skills`；Gemini CLI `~/.gemini/skills`。
 */
export function hostSkillsDir(host: AgentHost, env: NodeJS.ProcessEnv): string {
  switch (host) {
    case 'claude-code':
      return path.join(claudeConfigDir(env), 'skills');
    case 'codex':
      return path.join(codexHome(env), 'skills');
    case 'cursor':
      return path.join(userHome(env), '.cursor', 'skills');
    case 'gemini':
      return path.join(userHome(env), '.gemini', 'skills');
  }
}

// ---- MCP 配置 ----

/** 令牌怎么存：`env` 是放在宿主的环境变量段、配置里引用它；`plaintext` 是明文写在配置文件里。 */
export type TokenStorage = 'env' | 'plaintext';

export interface McpHostConfig {
  /** 写 BaoCut 那一项的文件。 */
  file: string;
  tokenStorage: TokenStorage;
  /** `env` 时：放令牌的文件与变量名。 */
  envFile?: string;
  envVar?: string;
}

/** 宿主的 MCP 配置放在哪里、令牌怎么存。 */
export function mcpHostConfig(host: AgentHost, env: NodeJS.ProcessEnv): McpHostConfig {
  switch (host) {
    // `claude mcp add --scope user` 写进 `~/.claude.json`（设了 `CLAUDE_CONFIG_DIR` 时是那个目录里的 `.claude.json`）的
    // `mcpServers`；请求头里的 `${VAR}` 会展开，`settings.json` 的 `env` 段能提供它。
    case 'claude-code':
      return {
        file: env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(userHome(env), '.claude.json'),
        tokenStorage: 'env',
        envFile: path.join(claudeConfigDir(env), 'settings.json'),
        envVar: MCP_TOKEN_ENV,
      };
    // `[mcp_servers.<名字>]` 的 `url` 与 `http_headers`；Codex 自己没有环境变量段（`bearer_token_env_var` 要在启动 Codex 的
    // shell 里导出），所以明文。
    case 'codex':
      return { file: path.join(codexHome(env), 'config.toml'), tokenStorage: 'plaintext' };
    // `mcpServers.<名字>` 的 `url` 与 `headers`；没有环境变量段，明文。
    case 'cursor':
      return { file: path.join(userHome(env), '.cursor', 'mcp.json'), tokenStorage: 'plaintext' };
    // `mcpServers.<名字>` 的 `url`、`type: 'http'` 与 `headers`；请求头里的变量只从进程环境或 `.env` 取，名字像令牌的还会被
    // 过滤掉，所以明文。
    case 'gemini':
      return { file: path.join(userHome(env), '.gemini', 'settings.json'), tokenStorage: 'plaintext' };
  }
}

/** 宿主的配置里有没有这一项（用户级）。配置读不懂时抛错。 */
export function hasMcpEntry(host: AgentHost, env: NodeJS.ProcessEnv, name: string = MCP_ENTRY_NAME): boolean {
  const { file } = mcpHostConfig(host, env);
  if (host === 'codex') return codexSectionRange(readText(file) ?? '', name) !== null;
  const servers = readJson(file).mcpServers;
  return isRecord(servers) && Object.hasOwn(servers, name);
}

/**
 * 宿主配置里这一项现在用的令牌（替换前读，用来认出旧客户端）：JSON 宿主读 `mcpServers.<名字>.headers.Authorization`，
 * Claude Code 的 `${VAR}` 引用到 `settings.json` 的 `env` 里取；Codex 读那一段（含子表）里的 `Authorization = "…"`。
 * 没有这一项、没有请求头或认不出时 null；配置读不懂时抛错。
 */
export function readMcpEntryToken(host: AgentHost, env: NodeJS.ProcessEnv, name: string = MCP_ENTRY_NAME): string | null {
  const config = mcpHostConfig(host, env);
  let header: string | null = null;
  if (host === 'codex') {
    const text = readText(config.file) ?? '';
    const range = codexSectionRange(text, name);
    if (!range) return null;
    for (const line of text.split('\n').slice(range.start, range.end)) {
      const match = /(?:^|[{,\s])"?Authorization"?\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(line);
      if (!match) continue;
      const quoted = match[1]!;
      try {
        header = quoted.startsWith('"') ? (JSON.parse(quoted) as string) : quoted.slice(1, -1);
      } catch {
        header = null;
      }
      break;
    }
  } else {
    const servers = readJson(config.file).mcpServers;
    const server = isRecord(servers) ? servers[name] : undefined;
    const headers = isRecord(server) ? server.headers : undefined;
    const value = isRecord(headers) ? headers.Authorization : undefined;
    header = typeof value === 'string' ? value : null;
  }
  if (!header) return null;
  const token = header.replace(/^\s*Bearer\s+/i, '').trim();
  const reference = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(token) ?? /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(token);
  if (!reference) return token || null;
  if (host !== 'claude-code') return null;
  const settings = readJson(config.envFile!);
  const value = isRecord(settings.env) ? settings.env[reference[1]!] : undefined;
  return typeof value === 'string' && value ? value : null;
}

/** 令牌里的客户端 id：BaoCut 发的令牌是 `<clientId>.<密钥>`；不是这个形状时 null。 */
export function clientIdOfToken(token: string): string | null {
  return /^([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/.exec(token)?.[1] ?? null;
}

export interface McpEntry {
  name: string;
  url: string;
  token: string;
}

export interface WriteMcpOptions {
  /** 调 `claude` 的函数：不给时在 `env.PATH` 上找，找不到或给 null 时直接写配置文件。 */
  runClaude?: ((args: string[]) => void) | null;
}

/** 写（或替换）宿主配置里的这一项。返回写到了哪里、令牌怎么存。 */
export function writeMcpEntry(host: AgentHost, env: NodeJS.ProcessEnv, entry: McpEntry, options: WriteMcpOptions = {}): McpHostConfig {
  const config = mcpHostConfig(host, env);
  const bearer = `Bearer ${entry.token}`;
  switch (host) {
    case 'claude-code': {
      // 令牌先进 settings.json 的 env，再写引用它的那一项；那一项没写成时把 env 里的旧值放回去（旧条目引用的是同一个变量）。
      let previous: unknown;
      updateJson(config.envFile!, (settings) => {
        const envBlock = isRecord(settings.env) ? settings.env : {};
        previous = envBlock[config.envVar!];
        settings.env = { ...envBlock, [config.envVar!]: entry.token };
      });
      const header = `Authorization: Bearer \${${config.envVar}}`;
      const runClaude = options.runClaude === undefined ? claudeRunner(env) : options.runClaude;
      try {
        if (runClaude) {
          if (hasMcpEntry(host, env, entry.name)) runClaude(['mcp', 'remove', '--scope', 'user', entry.name]);
          runClaude(['mcp', 'add', '--scope', 'user', '--transport', 'http', entry.name, entry.url, '--header', header]);
        } else {
          updateJson(config.file, (root) => {
            const servers = isRecord(root.mcpServers) ? root.mcpServers : {};
            root.mcpServers = {
              ...servers,
              [entry.name]: { type: 'http', url: entry.url, headers: { Authorization: `Bearer \${${config.envVar}}` } },
            };
          });
        }
      } catch (error) {
        try {
          updateJson(config.envFile!, (settings) => {
            const envBlock: Record<string, unknown> = isRecord(settings.env) ? { ...settings.env } : {};
            if (previous === undefined) delete envBlock[config.envVar!];
            else envBlock[config.envVar!] = previous;
            settings.env = envBlock;
          });
        } catch {
          // 放不回去就算了：报的仍是原来的错。
        }
        throw error;
      }
      return config;
    }
    case 'codex': {
      const text = readText(config.file) ?? '';
      const section = [
        `[mcp_servers.${entry.name}]`,
        `url = ${tomlString(entry.url)}`,
        `http_headers = { Authorization = ${tomlString(bearer)} }`,
      ];
      writeText(config.file, replaceCodexSection(text, entry.name, section.join('\n')));
      return config;
    }
    case 'cursor':
    case 'gemini': {
      updateJson(config.file, (root) => {
        const servers = isRecord(root.mcpServers) ? root.mcpServers : {};
        const value =
          host === 'gemini'
            ? { url: entry.url, type: 'http', headers: { Authorization: bearer } }
            : { url: entry.url, headers: { Authorization: bearer } };
        root.mcpServers = { ...servers, [entry.name]: value };
      });
      return config;
    }
  }
}

/** PATH 上有 `claude` 时返回调用它的函数（带上这次的环境变量，`CLAUDE_CONFIG_DIR` 照样生效）。 */
function claudeRunner(env: NodeJS.ProcessEnv): ((args: string[]) => void) | null {
  const command = findOnPath('claude', env);
  if (!command) return null;
  return (args) => {
    execFileSync(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'], timeout: 30_000 });
  };
}

export function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext.toLowerCase());
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch {
        // 下一个。
      }
    }
  }
  return null;
}

// ---- Codex 的 TOML：只认 `[mcp_servers.<名字>]` 这一段（含它的子表），不解析整份文件 ----

/** `[mcp_servers.<名字>]` 与它的子表（`[mcp_servers.<名字>.env]` 等）所占的行；没有时 null。 */
export function codexSectionRange(text: string, name: string): { start: number; end: number } | null {
  const lines = text.split('\n');
  const own = (line: string) => {
    const header = /^\s*\[\s*([^\]]+?)\s*\]\s*(#.*)?$/.exec(line);
    if (!header || line.trimStart().startsWith('[[')) return null;
    const parts = header[1]!.split('.').map((part) => part.trim().replace(/^"(.*)"$/, '$1'));
    return parts[0] === 'mcp_servers' && parts[1] === name;
  };
  const start = lines.findIndex((line) => own(line) === true);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length) {
    const isHeader = /^\s*\[/.test(lines[end]!);
    if (isHeader && own(lines[end]!) !== true) break;
    end++;
  }
  // 段后的空行不算这一段。
  while (end > start + 1 && lines[end - 1]!.trim() === '') end--;
  return { start, end };
}

function replaceCodexSection(text: string, name: string, section: string): string {
  const range = codexSectionRange(text, name);
  if (!range) {
    const base = text.replace(/\s*$/, '');
    return `${base ? `${base}\n\n` : ''}${section}\n`;
  }
  const lines = text.split('\n');
  lines.splice(range.start, range.end - range.start, ...section.split('\n'));
  return lines.join('\n');
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

// ---- 文件 ----

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function readJson(file: string): Record<string, unknown> {
  const text = readText(file);
  if (text === null || text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(M.invalidJson(file, error instanceof Error ? error.message : String(error)));
  }
  if (!isRecord(parsed)) throw new Error(M.notObject(file));
  return parsed;
}

/** 读、改、写回 JSON：沿用文件原来的缩进（制表符、几个空格或整份一行）、换行符与结尾有没有换行；新文件两个空格。 */
function updateJson(file: string, change: (root: Record<string, unknown>) => void): void {
  const before = readText(file);
  const root = readJson(file);
  change(root);
  const blank = before === null || before.trim() === '';
  const eol = !blank && before.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(root, null, blank ? 2 : jsonIndent(before)).replace(/\n/g, eol);
  writeText(file, `${body}${blank || /\n$/.test(before) ? eol : ''}`);
}

/**
 * JSON 文本用的缩进：第一行有缩进的行的前导空白（制表符或几个空格）；有内容却整份写在一行时 0（照样写成一行）；
 * 空对象这类看不出的两个空格。
 */
export function jsonIndent(text: string): string | number {
  const match = /\n([ \t]+)\S/.exec(text);
  if (match) return match[1]!.startsWith('\t') ? '\t' : match[1]!.length;
  return !text.trim().includes('\n') && text.includes(':') ? 0 : 2;
}

/** 原子替换（配置是符号链接时替换它指向的文件）；已有文件保留它的权限，新文件只给自己读写（里面可能有令牌）。 */
function writeText(link: string, text: string): void {
  const file = fs.existsSync(link) ? fs.realpathSync(link) : link;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch {
    // 新文件。
  }
  const temp = `${file}.baocut-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, text, { mode });
    // 新建时的权限受 umask 影响：按原文件的再设一次。
    if (process.platform !== 'win32') fs.chmodSync(temp, mode);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
