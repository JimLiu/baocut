/**
 * 导入 Claude Code 的本机会话（产品设计 §3.1「导入外部会话」）：读 `$CLAUDE_CONFIG_DIR/projects/<编码后的目录>/<sessionId>.jsonl`。
 *
 * 读法参考了 paseo 的 packages/server/src/server/agent/providers/claude/agent.ts（`collectRecentClaudeSessions`、
 * `parseClaudeSessionDescriptor`、`isSyntheticUserEntry`、`extractClaudeUserText`），Apache-2.0，
 * Copyright (c) 2025-present Mohamed Boudra；modified：改成按行流式读出 BaoCut 的 `NativeSession` / `NativeSessionHistory`，
 * 标题取第一句话，工具调用只留标题。
 */
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RpcError, type ToolCallKind } from '@baocut/protocol';
import type { NativeSession, NativeSessionHistory, NativeStep, NativeTurn } from '@baocut/harness';
import { DriversCommon } from '@baocut/protocol/messages/agent-drivers';

/** 列表时最多读几个记录文件的开头：按修改时间取最新的，再按需要的条数截。 */
const SCAN_LIMIT = 400;

type Entry = Record<string, unknown>;

const isRecord = (value: unknown): value is Entry => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 按修改时间从新到旧的记录文件。 */
async function recentFiles(configDir: string, limit: number): Promise<Array<{ file: string; mtime: Date }>> {
  const root = path.join(configDir, 'projects');
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: Array<{ file: string; mtime: Date }> = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const names = await fs.readdir(path.join(root, dir.name)).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(root, dir.name, name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat?.isFile()) files.push({ file, mtime: stat.mtime });
    }
  }
  return files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime()).slice(0, limit);
}

/** 一行一行读记录文件，读不了的行跳过。 */
async function* entries(file: string): AsyncGenerator<Entry> {
  const stream = createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  let rest = '';
  try {
    for await (const chunk of stream) {
      const lines = (rest + (chunk as string)).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        const entry = parseLine(line);
        if (entry) yield entry;
      }
    }
    const last = parseLine(rest);
    if (last) yield last;
  } finally {
    stream.destroy();
  }
}

function parseLine(line: string): Entry | null {
  if (!line.trim()) return null;
  try {
    const value = JSON.parse(line) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;
/** 不是用户写的话：本机命令的输出、打断与「不用回复」的占位、系统提醒。 */
const NOISE =
  /^(<local-command-std(out|err)>|<bash-(stdout|stderr)>|<system-reminder>|\[Request interrupted by user|No response requested\.)/;

/** 用户这一条里的话；工具结果、元信息、合成的消息与噪声为 null。斜杠命令写成 `/命令 参数`。 */
export function userText(entry: Entry): string | null {
  if (entry.type !== 'user' || entry.isSidechain || entry.isMeta === true || entry.isSynthetic === true || entry.toolUseResult) return null;
  const message = isRecord(entry.message) ? entry.message : null;
  if (!message) return null;
  const parts: string[] = [];
  if (typeof message.content === 'string') parts.push(message.content);
  else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!isRecord(block)) continue;
      if (block.type === 'tool_result') return null;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
  }
  const text = parts
    .map((part) => part.trim())
    .filter((part) => part && !NOISE.test(part))
    .join('\n\n');
  if (!text) return null;
  const command = text.match(COMMAND_NAME)?.[1]?.trim();
  if (command) {
    const args = text.match(COMMAND_ARGS)?.[1]?.trim();
    return `${command.startsWith('/') ? command : `/${command}`}${args ? ` ${args}` : ''}`;
  }
  return text;
}

/** 列表里的一行：第一句话，压成一行，最长 160 字。 */
export function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const end = line.search(/[。！？!?]|\.(\s|$)/);
  const sentence = end >= 0 ? line.slice(0, end + 1) : line;
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence;
}

const timestampOf = (entry: Entry): string | null => (typeof entry.timestamp === 'string' ? entry.timestamp : null);

/** 本机的 Claude Code 会话，最近用过的在前。主会话的记录才算（子智能体的在别的文件里，也不带用户的话）。 */
export async function listClaudeSessions(configDir: string, limit: number): Promise<NativeSession[]> {
  const sessions: NativeSession[] = [];
  for (const { file, mtime } of await recentFiles(configDir, Math.min(SCAN_LIMIT, limit * 2))) {
    let sessionId: string | null = null;
    let cwd: string | null = null;
    let title = '';
    let turns = 0;
    for await (const entry of entries(file)) {
      if (entry.isSidechain) continue;
      sessionId ??= typeof entry.sessionId === 'string' ? entry.sessionId : null;
      cwd ??= typeof entry.cwd === 'string' ? entry.cwd : null;
      const text = userText(entry);
      if (!text) continue;
      turns++;
      if (!title) title = firstSentence(text);
    }
    if (!sessionId || turns === 0) continue;
    sessions.push({
      nativeId: sessionId,
      cwd,
      title,
      turns,
      updatedAt: mtime.toISOString(),
      persistence: { driverId: 'claude', data: { sessionId } },
    });
    if (sessions.length >= limit) break;
  }
  return sessions;
}

/** 找到这条会话的记录文件：会话按开始时的目录存，不知道目录时逐个找。 */
async function sessionFile(configDir: string, sessionId: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  const root = path.join(configDir, 'projects');
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(root, dir.name, `${sessionId}.jsonl`);
    if (
      await fs.stat(file).then(
        (s) => s.isFile(),
        () => false,
      )
    )
      return file;
  }
  return null;
}

/** 读一条会话的记录：用户的每句话起一轮，之后的回复文字与工具调用归这一轮；工具结果只用来定步骤成没成。 */
export async function readClaudeSession(configDir: string, sessionId: string): Promise<NativeSessionHistory> {
  const file = await sessionFile(configDir, sessionId);
  if (!file) throw new RpcError('not-found', DriversCommon.nativeSessionNotFound({ id: sessionId }));
  let cwd: string | null = null;
  const turns: NativeTurn[] = [];
  const tools = new Map<string, Extract<NativeStep, { kind: 'tool' }>>();
  for await (const entry of entries(file)) {
    if (entry.isSidechain) continue;
    cwd ??= typeof entry.cwd === 'string' ? entry.cwd : null;
    const at = timestampOf(entry);
    const text = userText(entry);
    if (text) {
      turns.push({ user: text, startedAt: at, endedAt: at, steps: [] });
      continue;
    }
    const turn = turns.at(-1);
    if (!turn) continue;
    const message = isRecord(entry.message) ? entry.message : null;
    const blocks = Array.isArray(message?.content) ? message.content.filter(isRecord) : [];
    if (entry.type === 'user') {
      for (const block of blocks) {
        const step = block.type === 'tool_result' && typeof block.tool_use_id === 'string' ? tools.get(block.tool_use_id) : undefined;
        if (step && block.is_error === true) step.status = 'failed';
      }
    } else if (entry.type === 'assistant') {
      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
          const last = turn.steps.at(-1);
          if (last?.kind === 'message') last.text += `\n\n${block.text.trim()}`;
          else turn.steps.push({ kind: 'message', text: block.text.trim() });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          const step: Extract<NativeStep, { kind: 'tool' }> = { kind: 'tool', ...toolTitle(block.name, block.input), status: 'completed' };
          turn.steps.push(step);
          if (typeof block.id === 'string') tools.set(block.id, step);
        }
      }
    } else continue;
    if (at) turn.endedAt = at;
  }
  const title = turns[0] ? firstSentence(turns[0].user) : '';
  return { nativeId: sessionId, cwd, title, turns, persistence: { driverId: 'claude', data: { sessionId } } };
}

const clip = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** 工具调用的一行标题：常用工具写出它在做什么（命令、文件、网址），其余写工具名。 */
function toolTitle(name: string, raw: unknown): { tool: ToolCallKind; title: string; detail: string | null } {
  const input = isRecord(raw) ? raw : {};
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : null);
  if (name === 'Bash') return { tool: 'command', title: clip(str('command')?.split('\n')[0] ?? name, 160), detail: str('description') };
  if (name === 'WebSearch') return { tool: 'web-search', title: clip(str('query') ?? name, 160), detail: null };
  if (name.startsWith('mcp__')) return { tool: 'mcp', title: name.split('__').slice(1).join(' · '), detail: null };
  const target = str('file_path') ?? str('notebook_path') ?? str('path') ?? str('url') ?? str('pattern') ?? str('description');
  // 改文件的步骤也记成 `other`：导入的是别处做过的事，不算这个会话在外面留下的作用（不进后台任务表）。
  return { tool: 'other', title: target ? `${name} ${clip(target, 160)}` : name, detail: null };
}
