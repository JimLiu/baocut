/**
 * 导入 Codex 的本机会话（产品设计 §3.1「导入外部会话」）：起临时 app-server，`thread/list` 列出、`thread/read` 读出记录
 * （分页存的线程用 `thread/items/list`）。
 *
 * 分页与两种存法参考了 paseo 的 packages/server/src/server/agent/providers/codex-app-server-agent.ts（`readCodexThreadWindow`）
 * 与 codex/thread-history.ts（`readCodexThreadHistory`），Apache-2.0，Copyright (c) 2025-present Mohamed Boudra；
 * modified：改成 BaoCut 的 `NativeSession` / `NativeSessionHistory`，没给工作目录的线程不猜目录。
 */
import { RpcError } from '@baocut/protocol';
import type { Logger, NativeSession, NativeSessionHistory, NativeStep, NativeTurn } from '@baocut/harness';
import { DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import { firstSentence } from '../claude/claude-import.ts';
import type { CodexInstall } from './codex-binary.ts';
import { withTempAppServer } from './codex-models.ts';
import type { CodexRpcConnection } from './rpc-connection.ts';

const TIMEOUT_MS = 30_000;
/** Codex 每页最多回 100 条；读记录时最多翻这么多页。 */
const PAGE_SIZE = 100;
const MAX_PAGES = 200;

type Row = Record<string, unknown>;
const isRecord = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
/** Codex 的时间是秒（也可能是毫秒或 ISO 字符串）。 */
function isoOf(value: unknown): string | null {
  if (typeof value === 'string') return Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString();
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value < 1e12 ? value * 1000 : value).toISOString();
}

/** 本机的 Codex 线程，最近用过的在前。没有工作目录的照列（不能导入，界面写明）。 */
export async function listCodexThreads(install: CodexInstall, log: Logger, limit: number): Promise<NativeSession[]> {
  return withTempAppServer(install, log, TIMEOUT_MS, 'thread/list', async (conn) => {
    const threads = new Map<string, Row>();
    let cursor: string | null = null;
    while (threads.size < limit) {
      const res: unknown = await conn.request(
        'thread/list',
        { limit: limit - threads.size, sortKey: 'updated_at', ...(cursor ? { cursor } : {}) },
        TIMEOUT_MS,
      );
      const page = isRecord(res) && Array.isArray(res.data) ? res.data.filter(isRecord) : [];
      const before = threads.size;
      for (const thread of page) {
        const id = str(thread.id);
        if (id && !threads.has(id)) threads.set(id, thread);
      }
      cursor = isRecord(res) ? str(res.nextCursor) : null;
      // 游标不前进（翻了一页却没有新线程）时停下，不无限翻。
      if (!cursor || threads.size === before) break;
    }
    return [...threads.values()].map((thread) => ({
      nativeId: String(thread.id),
      persistence: { driverId: 'codex', data: { threadId: String(thread.id) } },
      cwd: str(thread.cwd),
      title: firstSentence(str(thread.name) ?? str(thread.preview) ?? ''),
      turns: null,
      updatedAt: isoOf(thread.updatedAt) ?? isoOf(thread.createdAt) ?? new Date(0).toISOString(),
    }));
  });
}

/** 读一条线程：每个用户输入起一轮，之后的回复与工具步骤归这一轮。 */
export async function readCodexThread(install: CodexInstall, log: Logger, threadId: string): Promise<NativeSessionHistory> {
  return withTempAppServer(install, log, TIMEOUT_MS, 'thread/read', async (conn) => {
    let meta: unknown;
    try {
      meta = await conn.request('thread/read', { threadId, includeTurns: false }, TIMEOUT_MS);
    } catch {
      throw new RpcError('not-found', DriversCommon.nativeSessionNotFound({ id: threadId }));
    }
    const thread = isRecord(meta) && isRecord(meta.thread) ? meta.thread : {};
    const rows = thread.historyMode === 'paginated' ? await pagedItems(conn, threadId) : await legacyItems(conn, threadId);
    const turns = toTurns(rows);
    const title = firstSentence(str(thread.name) ?? turns[0]?.user ?? str(thread.preview) ?? '');
    return { nativeId: threadId, cwd: str(thread.cwd), title, turns, persistence: { driverId: 'codex', data: { threadId } } };
  });
}

interface ItemRow {
  item: Row;
  turnId: string | null;
  at: string | null;
}

/** 旧的存法：一次 `thread/read` 带回所有回合。 */
async function legacyItems(conn: CodexRpcConnection, threadId: string): Promise<ItemRow[]> {
  const res: unknown = await conn.request('thread/read', { threadId, includeTurns: true }, TIMEOUT_MS);
  const turns = isRecord(res) && isRecord(res.thread) && Array.isArray(res.thread.turns) ? res.thread.turns.filter(isRecord) : [];
  return turns.flatMap((turn) =>
    (Array.isArray(turn.items) ? turn.items.filter(isRecord) : []).map((item) => ({
      item,
      turnId: str(turn.id),
      at: isoOf(turn.completedAt) ?? isoOf(turn.startedAt),
    })),
  );
}

/** 分页的存法：`thread/items/list` 从早到晚一页页取。 */
async function pagedItems(conn: CodexRpcConnection, threadId: string): Promise<ItemRow[]> {
  const rows: ItemRow[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: unknown = await conn.request(
      'thread/items/list',
      { threadId, limit: PAGE_SIZE, sortDirection: 'asc', ...(cursor ? { cursor } : {}) },
      TIMEOUT_MS,
    );
    for (const row of isRecord(res) && Array.isArray(res.data) ? res.data.filter(isRecord) : []) {
      if (isRecord(row.item))
        rows.push({ item: row.item, turnId: str(row.turnId), at: isoOf(row.completedAtMs) ?? isoOf(row.startedAtMs) });
    }
    cursor = isRecord(res) ? str(res.nextCursor) : null;
    if (!cursor || seen.has(cursor)) break;
    seen.add(cursor);
  }
  return rows;
}

const clip = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function toTurns(rows: ItemRow[]): NativeTurn[] {
  const turns: NativeTurn[] = [];
  for (const { item, at } of rows) {
    if (item.type === 'userMessage') {
      const content = Array.isArray(item.content) ? item.content.filter(isRecord) : [];
      const text = content
        .map((part) => (typeof part.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean)
        .join('\n\n');
      if (text) turns.push({ user: text, startedAt: at, endedAt: at, steps: [] });
      continue;
    }
    const turn = turns.at(-1);
    if (!turn) continue;
    const step = toStep(item);
    if (!step) continue;
    const last = turn.steps.at(-1);
    if (step.kind === 'message' && last?.kind === 'message') last.text += `\n\n${step.text}`;
    else turn.steps.push(step);
    if (at) turn.endedAt = at;
  }
  return turns;
}

function toStep(item: Row): NativeStep | null {
  const failed = item.status === 'failed' || item.status === 'declined';
  const status = failed ? ('failed' as const) : ('completed' as const);
  switch (item.type) {
    case 'agentMessage': {
      const text = str(item.text)?.trim();
      return text ? { kind: 'message', text } : null;
    }
    case 'commandExecution':
      return { kind: 'tool', tool: 'command', title: clip(str(item.command)?.split('\n')[0] ?? 'command'), detail: null, status };
    case 'fileChange': {
      const paths = (Array.isArray(item.changes) ? item.changes.filter(isRecord) : [])
        .map((c) => str(c.path))
        .filter((p): p is string => !!p);
      // 改文件的步骤记成 `other`：导入的是别处做过的事，不算这个会话在外面留下的作用（不进后台任务表）。
      return { kind: 'tool', tool: 'other', title: clip(`Edit ${paths.join(', ')}`.trim()), detail: null, status };
    }
    case 'mcpToolCall':
      return {
        kind: 'tool',
        tool: 'mcp',
        title: clip([str(item.server), str(item.tool)].filter(Boolean).join(' · ') || 'mcp'),
        detail: null,
        status,
      };
    case 'webSearch':
      return { kind: 'tool', tool: 'web-search', title: clip(str(item.query) ?? 'search'), detail: null, status: 'completed' };
    case 'dynamicToolCall':
      return { kind: 'tool', tool: 'other', title: clip(str(item.tool) ?? 'tool'), detail: null, status };
    default:
      return null;
  }
}
