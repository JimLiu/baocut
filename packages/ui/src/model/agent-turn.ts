import { defineMessages, live as liveMessages, type TaskStatus, type TimelineItem } from '@baocut/protocol';
import { formatClock } from './format.ts';
import { relativePath, type ThreadBlock } from './thread.ts';
import { zhHans } from './agent-turn.zh-Hans.ts';
import { zhHant } from './agent-turn.zh-Hant.ts';
import { ja } from './agent-turn.ja.ts';
import { ko } from './agent-turn.ko.ts';
import { es } from './agent-turn.es.ts';
import { fr } from './agent-turn.fr.ts';
import { de } from './agent-turn.de.ts';
import { nl } from './agent-turn.nl.ts';
import { ptBR } from './agent-turn.pt-BR.ts';
import { it } from './agent-turn.it.ts';
import { ru } from './agent-turn.ru.ts';
import { pl } from './agent-turn.pl.ts';
import { tr } from './agent-turn.tr.ts';
import { vi } from './agent-turn.vi.ts';

/** 会话线程里回合页脚与步骤的文案（英文是键与类型的来源，译文在 `agent-turn.zh-Hans.ts`）。 */
const en = {
  waiting: 'Waiting for your approval',
  working: 'Working',
  stopping: 'Stopping',
  worked: (span: string) => `Worked for ${span}`,
  stoppedAfter: (span: string) => `Stopped · worked for ${span}`,
  stopped: 'Stopped',
  failed: (error: string | null) => `Failed · ${error ?? 'unknown reason'}`,
  stepStatus: { declined: 'Declined', interrupted: 'Interrupted' } as Partial<Record<ToolCall['status'], string>>,
  exitCode: (code: number) => `Exit code ${code}`,
  stepDeclined: 'This step was declined',
  commandExited: (code: number) => `The command exited with code ${code}`,
  stepIncomplete: 'This step didn’t finish',
  lineRange: (path: string, line: number, end: number) => `${path} · lines ${line}–${end}`,
  lineCol: (path: string, line: number, col: number) => `${path} · line ${line}, column ${col}`,
  line: (path: string, line: number) => `${path} · line ${line}`,
};
export type AgentTurnMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * Agent 会话线程里「算出来的东西」（产品设计 §3.2.2）：行间距、回合与页脚、步骤输出的 diff、正文里的文件路径。
 * 纯函数；工具步骤的类别与组头摘要在 thread.ts（`toolStep` / `stepsSummary`）。
 */

type Task = Extract<TimelineItem, { kind: 'task' }>;

// ---- 间距 ----

/** 线程里一行的种类。`block` 是同一条回复里的 Markdown 块，`footer` 是回合页脚。 */
export type RowKind = 'user' | 'assistant' | 'tool' | 'approval' | 'notice' | 'block' | 'footer';

const GAPS: Partial<Record<`${RowKind}>${RowKind}`, number>> = {
  'user>user': 4,
  'user>assistant': 0,
  'tool>tool': 0,
  'user>tool': 16,
  'assistant>tool': 4,
  'tool>assistant': 4,
  'block>block': 12,
};

/** 相邻两行的间距：卡片后留 24，任何行到页脚是 4，第一行是 0，其余按种类查表。 */
export function gapBetween(prev: RowKind | null, next: RowKind, prevHasCards = false): number {
  if (!prev) return 0;
  if (next === 'footer') return 4;
  if (prevHasCards) return 24;
  return GAPS[`${prev}>${next}`] ?? 16;
}

/** 线程块的行种类：步骤组算 tool，任务状态行算页脚。 */
export function rowKind(block: ThreadBlock): RowKind {
  switch (block.type) {
    case 'user':
      return 'user';
    case 'agent':
      return 'assistant';
    case 'steps':
      return 'tool';
    case 'task':
      return 'footer';
    default:
      return block.type;
  }
}

// ---- 回合 ----

export interface Turn {
  /** 回合第一块与最后一个内容块（不含任务状态行）在线程块里的下标；页脚挂在 `end` 之后。 */
  start: number;
  end: number;
  hasUser: boolean;
  /** 有用户消息以外的内容。 */
  replied: boolean;
  /** 这一轮 assistant 正文（Markdown 源码，空行连接），不含工具与思考。 */
  text: string;
  /** 这一轮的任务（有几个取最后一个）。 */
  task: Task | null;
  /** 有还在等决定的审批。 */
  waiting: boolean;
}

/** 把线程块切成回合：从一条用户消息到下一条之前。任务状态行不算内容，只记成这一轮的任务。 */
export function turns(blocks: readonly ThreadBlock[]): Turn[] {
  const out: (Turn & { texts: string[] })[] = [];
  let cur: (Turn & { texts: string[] }) | null = null;
  blocks.forEach((block, i) => {
    if (block.type === 'user' || !cur) {
      cur = { start: i, end: i, hasUser: block.type === 'user', replied: false, text: '', task: null, waiting: false, texts: [] };
      out.push(cur);
    }
    if (block.type === 'task') {
      cur.task = block.item;
      return;
    }
    cur.end = i;
    if (block.type !== 'user') cur.replied = true;
    if (block.type === 'agent' && block.item.text.trim()) cur.texts.push(block.item.text.trim());
    if (block.type === 'approval' && block.item.status === 'pending') cur.waiting = true;
  });
  return out.map(({ texts, ...turn }) => ({ ...turn, text: texts.join('\n\n') }));
}

/** 页脚要不要出：进行中总出；否则要有用户消息，并且有回复，或者这一轮停下、失败了（状态要交代）。 */
export function showFooter(turn: Turn, live: boolean): boolean {
  if (live) return true;
  if (!turn.hasUser) return false;
  return turn.replied || turn.task?.status === 'stopped' || turn.task?.status === 'failed';
}

/** 时长：0:42、1:03、1:02:05。 */
export function elapsedLabel(ms: number): string {
  return formatClock(Math.max(0, ms) / 1000);
}

/** 结束时刻：本地 24 小时制 14:32。 */
export function clockLabel(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 页脚文案。进行中「正在工作 · 0:42」，停下来等允许时「等你允许 · 0:42」；完成「已工作 1:03」；
 * 停止与失败照任务事件写。没有任务（还没开始）时进行中只写「正在工作」。
 */
export function footerLabel(input: {
  status: TaskStatus | null;
  startedAt?: number | null;
  endedAt?: number | null;
  now: number;
  waiting?: boolean;
  error?: string | null;
}): string {
  const { status, startedAt, endedAt, now, waiting, error } = input;
  const span = startedAt != null ? elapsedLabel((endedAt ?? now) - startedAt) : null;
  const live = (word: string) => (span ? `${word} · ${span}` : word);
  switch (status) {
    case null:
    case 'running':
      return live(waiting ? M.waiting : M.working);
    case 'stopping':
      return live(M.stopping);
    case 'completed':
      return span ? M.worked(span) : '';
    case 'stopped':
      return span ? M.stoppedAfter(span) : M.stopped;
    case 'failed':
      return M.failed(error ?? null);
  }
}

// ---- 工具输出 ----

export type DiffLineType = 'add' | 'del' | 'hunk' | 'meta' | 'ctx';

/** unified diff 的每一行归类。 */
export function diffLines(text: string): { type: DiffLineType; text: string }[] {
  return text
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => {
      let type: DiffLineType = 'ctx';
      if (/^(\+\+\+|---)(\s|$)/.test(line) || /^(diff |index )/.test(line)) type = 'meta';
      else if (line.startsWith('@@')) type = 'hunk';
      else if (line.startsWith('+')) type = 'add';
      else if (line.startsWith('-')) type = 'del';
      return { type, text: line };
    });
}

/** 输出是不是一段 unified diff：有 `@@` 块头，或成对的 `---` / `+++` 文件头。 */
export function looksLikeDiff(text: string): boolean {
  return /^@@ .* @@/m.test(text) || (/^--- \S/m.test(text) && /^\+\+\+ \S/m.test(text));
}

type ToolCall = Extract<TimelineItem, { kind: 'tool-call' }>;

/** 步骤耗时：0.4s、12s、1:03。 */
export function durationLabel(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return elapsedLabel(ms);
}

const STATUS_META: Partial<Record<ToolCall['status'], string>> = liveMessages(() => M.stepStatus);

/** 折叠行右侧的元数据：被拒绝 / 中断、非零退出码（`code`，失败时标红）、耗时。`status` 是界面上锁存后的状态。 */
export function stepMeta(item: ToolCall, status: ToolCall['status']): { text: string; code?: boolean }[] {
  const out: { text: string; code?: boolean }[] = [];
  const word = STATUS_META[status];
  if (word) out.push({ text: word });
  if (item.exitCode !== null && item.exitCode !== 0) out.push({ text: M.exitCode(item.exitCode), code: true });
  if (item.durationMs !== null) out.push({ text: durationLabel(item.durationMs) });
  return out;
}

/** 失败与被拒绝的步骤展开后「错误」一段的文字。 */
export function stepError(item: ToolCall, status: ToolCall['status']): string {
  if (status === 'declined') return M.stepDeclined;
  if (item.exitCode !== null && item.exitCode !== 0) return M.commandExited(item.exitCode);
  return M.stepIncomplete;
}

/** 工具状态的更新：一旦失败，不再被之后的更新改回。 */
export function nextToolStatus<S extends string>(prev: S | null, next: S): S {
  return prev === 'failed' ? prev : next;
}

// ---- 正文里的文件路径 ----

/** 认作文件路径的扩展名。 */
export const FILE_EXT = [
  'pdf', 'html', 'htm', 'csv', 'tsv', 'txt', 'markdown', 'xml', 'sql',
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'md',
  'css',
  'rs',
  'py',
  'toml',
  'yaml',
  'yml',
  'srt',
  'vtt',
  'ass',
  'mp4',
  'mov',
  'wav',
  'mp3',
  'png',
  'jpg',
];
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;

export interface PathToken {
  path: string;
  line: number | null;
  lineEnd: number | null;
  col: number | null;
}

/**
 * 行内代码像不像文件路径：有目录前缀（`./` `../` `~/` `/`），或多段路径且最后一段是已知扩展名；
 * 可带 `:行`、`:起-止`、`:行:列`。纯文件名、网址、带空白或查询串的不算。
 */
export function parsePathToken(text: string): PathToken | null {
  const raw = text.trim();
  if (!raw || /\s/.test(raw) || raw.includes('?') || raw.includes('://')) return null;
  const m = /^(.*?)(?::(\d+)(?:-(\d+)|:(\d+))?)?$/.exec(raw)!;
  const path = m[1]!;
  if (!path) return null;
  const prefixed = /^(\.\.?\/|~\/|\/)/.test(path) && !/^\/\//.test(path) && path.length > 1;
  if (!prefixed) {
    const segs = path.split('/');
    if (segs.length < 2 || segs.some((s, i) => !s && i < segs.length - 1)) return null;
    const ext = /\.([a-z0-9]+)$/i.exec(segs[segs.length - 1]!);
    if (!ext || !FILE_EXT.includes(ext[1]!.toLowerCase())) return null;
    if (DOMAIN.test(segs[0]!)) return null;
  }
  const num = (v: string | undefined) => (v == null ? null : Number(v));
  return { path, line: num(m[2]), lineEnd: num(m[3]), col: num(m[4]) };
}

/** tooltip 的文字：相对路径与行范围。 */
export function pathTip(p: PathToken, cwd?: string | null): string {
  const path = relativePath(p.path, cwd);
  if (p.line == null) return path;
  if (p.lineEnd != null) return M.lineRange(path, p.line, p.lineEnd);
  if (p.col != null) return M.lineCol(path, p.line, p.col);
  return M.line(path, p.line);
}
