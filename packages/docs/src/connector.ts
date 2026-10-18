/**
 * 智能体的连接器（docs/design/docs §7）：会话里的 docs_* 工具经它读写文档，写法照搬 Claude Docs 的连接器
 * （docs skill 与它的 references 写的就是这里的行为）。
 *
 * - 与编辑器经同一份 LiveDoc / door 读写：写入即时推给开着的编辑器，评论记在智能体名下。
 * - 正文的写法比编辑器的多一层：`find` / `cell` 目标、整块写的 guard（`ifHash` / `ifRev`）、`as:'text'` 原地改字、
 *   `dropped`、`anchors_affected`、表格加列（`each`）、`restore`；读有大纲、一节、搜索、版本、`sinceRev`、`atRev`。
 * - 被拒时抛 `DocsRefusal`（`code` 是拒绝码），什么也没改。写入在返回前落盘（调用方随后读 doc.json 更新卡片）。
 */
import { createHash } from 'node:crypto';
import { isCharId, parseCharId, type CharId } from './char-id.ts';
import { anchoredIds, projectValue, substituteLids, UnknownLid, type DocDoor, type DoorContext } from './door.ts';
import { allow, type DoorAllow, type DoorDeny, type DoorRequest, type DoorVerdict } from './door-types.ts';
import type { LiveDoc } from './live-doc.ts';
import { ackXml, blockHash, blocksXml, docXml, searchXml, sectionBlocks, sinceXml, type AgentXmlContext, type SearchHit } from './agent-xml.ts';
import { blocksToMarkdown, markdownToWire } from './markdown.ts';
import { applyProseOps, isBlockSource, type InlineSource, type OpResult, type ProseOp, type WireNode } from './prose-ops.ts';
import {
  findBlock,
  findItem,
  isTextBlock,
  walkBlocks,
  type BlockLocation,
  type CellBlock,
  type CharItem,
  type InlineItem,
  type ProseBlock,
  type TableBlock,
  type TableRowBlock,
  type TextBlock,
} from './prose-document.ts';
import { newDocState, readDocInfo, visibleTabs, type DocMeta, type DocState, type DocTab, type LiveNode } from './store.ts';
import { listVersions } from './versions.ts';

/** 智能体在文档里的身份（评论与修改记在它名下）。`conversation` / `turn` 是它所在的会话与回合，版本按回合分开。 */
export interface DocsActor {
  id: string;
  name: string;
  conversation?: string;
  turn?: string;
}

/** 连接器的拒绝：`code` 是拒绝码（`find_none`、`guard_mismatch`……），`details` 是修好它要的细节。什么也没改。 */
export class DocsRefusal extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DocsRefusal';
    this.code = code;
    this.details = details;
  }
}

export interface DocsContainer {
  kind: string;
  id?: string;
  [key: string]: unknown;
}

export interface DocsRef {
  object: string;
  id: string;
}

type Result = Record<string, unknown>;

export interface DocsConnector {
  batch(dir: string, args: { container: DocsContainer; batch: Record<string, unknown>[] }, actor: DocsActor): Promise<Result>;
  create(dir: string, args: { object: string; container?: DocsContainer; engine?: string; payload: Record<string, unknown> }, actor: DocsActor): Promise<Result>;
  read(dir: string, args: { ref?: DocsRef; engine?: string; container?: DocsContainer; payload?: Record<string, unknown> }, actor: DocsActor): Promise<Result>;
  update(
    dir: string,
    args: { ref: DocsRef; engine?: string; container?: DocsContainer; payload: Record<string, unknown> | string; answering?: string },
    actor: DocsActor,
  ): Promise<Result>;
  query(dir: string, args: { object: string; container?: DocsContainer; payload: Record<string, unknown> }, actor: DocsActor): Promise<Result>;
  delete(dir: string, args: { ref: DocsRef; container?: DocsContainer }, actor: DocsActor): Promise<Result>;
  upload(
    dir: string,
    file: { bytes: Uint8Array; contentType: string; name: string },
    actor: DocsActor,
  ): Promise<{ blob: string; id: string; bytes: number; contentType: string; name?: string }>;
  exportMarkdown(dir: string, args: { tab?: string }): Promise<{ markdown: string; tabs: { id: string; name: string }[] }>;
}

/** 连接器用到的服务端：同一个目录在内存里只有一份文档。 */
export interface DocsConnectorHost {
  doc(dir: string): Promise<LiveDoc>;
  door(doc: LiveDoc): DocDoor;
  /** 还没写过盘的新文档（不进缓存）：新建成功后 `adopt`。 */
  fresh(dir: string, state: DocState): LiveDoc;
  adopt(doc: LiveDoc): void;
}

/** `each` 一次最多放几份。 */
const EACH_LIMIT = 4096;
/** `allowMultiple` 最多命中几处。 */
const FIND_LIMIT = 512;
const FIND_TEXT_MAX = 2000;
/** 一次调用最多几个 op。 */
const OPS_LIMIT = 512;
/** 整篇读超过这么多字符时改给大纲。 */
const FULL_READ_MAX = 150_000;
const SEARCH_LIMIT = 200;
const CHIP_PATTERN = /<\?claude\s+block\s+([A-Za-z0-9_.-]{1,64})\s*\?>/g;

// i18n-ignore-start: 给模型的拒绝说明

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(code: string, message: string, details?: Record<string, unknown>): never {
  throw new DocsRefusal(code, message, details);
}

/** door / 正文编辑的拒绝码 → 给智能体的拒绝码。 */
function agentCode(reason: string): string {
  if (reason === 'unsupported_construct') return 'unsupported';
  if (reason === 'unsupported_edit') return 'invalid_op';
  return reason;
}

function refuseVerdict(verdict: DoorDeny, extra: Record<string, unknown> = {}): never {
  const data = isRecord(verdict.data) ? verdict.data : verdict.data === undefined ? {} : { data: verdict.data };
  refuse(agentCode(verdict.reason), verdict.detail ?? verdict.reason, { ...data, ...extra });
}

function withIndex(error: DocsRefusal, index: number): DocsRefusal {
  if (error.details?.['index'] !== undefined) return error;
  return new DocsRefusal(error.code, error.message, { ...(error.details ?? {}), index });
}

function agentContext(actor: DocsActor, answering?: string): DoorContext {
  return {
    actor: {
      principal: actor.id || 'claude',
      name: actor.name || 'Claude',
      channel: 'agent',
      ...(actor.conversation ? { conversation: actor.conversation } : {}),
      ...(actor.turn ? { turn: actor.turn } : {}),
    },
    canEdit: true,
    ...(answering ? { answering } : {}),
  };
}

function fullId(value: unknown, what: string): CharId {
  if (isCharId(value)) return value;
  refuse('absent', `${what} 要写完整的 id（<session>.<clock>，例如 mq2x81a0kfd.90）：读的结果里的 .90 是简写，补上它上面最近一个完整 id 的前缀`, {
    id: value as string,
  });
}

function intOf(value: unknown, what: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) refuse('invalid_argument', `${what} 要是 ≥ ${min} 的整数`);
  return value;
}

/** 调用里的文档：`container.id` 写了就要是这份文档（或它的标签页）。 */
function checkContainer(doc: LiveDoc, container: DocsContainer | undefined): void {
  if (!container) return;
  if (container.kind !== 'project' && container.kind !== 'file') refuse('invalid_argument', 'container 要是 {"kind":"project","id":"<文档 id>"}');
  const id = container.id;
  if (id === undefined) return;
  if (typeof id !== 'string') refuse('invalid_argument', 'container.id 要是字符串');
  const bare = id.replace(/^(project|file)\//, '');
  const ok = container.kind === 'project' ? bare === doc.id : doc.meta.tabs.some((tab) => tab.id === bare);
  if (!ok) refuse('absent', `container ${id} 不是这份文档：这份文档的 id 是 ${doc.id}`, { object: container.kind, id, doc: doc.id });
}

/** 正文：`ref.id` 是正文 id；标签页 id 也认（取它的正文）。块 id 放错了地方时说明。 */
function requireNode(doc: LiveDoc, ref: { id?: unknown } | undefined): LiveNode {
  const id = typeof ref?.id === 'string' ? ref.id.replace(/^node\//, '') : '';
  const direct = doc.node(id);
  if (direct) return direct;
  const tab = doc.meta.tabs.find((candidate) => candidate.id === id);
  const viaTab = tab?.nodeId ? doc.node(tab.nodeId) : undefined;
  if (viaTab) return viaTab;
  if (isCharId(id)) refuse('absent', `${id} 是块的 id：ref 是正文 node（docs_read 的 files[].content.id），块 id 放在 target.ids`, { object: 'node', id });
  refuse('absent', `这份文档里没有正文 ${id}：用 docs_read 的 files[].content.id`, { object: 'node', id });
}

function xmlContext(door: DocDoor, node: LiveNode, rev = node.rev): AgentXmlContext {
  const threads = door.doc.threads
    .filter((thread) => thread.nodeId === node.id && !thread.resolved && thread.anchor)
    .map((thread) => ({
      id: thread.id,
      from: thread.anchor!.from,
      to: thread.anchor!.to,
      ...(thread.to?.includes('claude') ? { toClaude: true, answered: thread.replies.some((reply) => !reply.kind && reply.author.channel === 'agent') } : {}),
    }));
  return { rev, threads, self: door.user.principal, enums: door.doc.meta.enums };
}

function subtreeRev(block: ProseBlock): number {
  let rev = 0;
  for (const { block: inner } of walkBlocks([block])) rev = Math.max(rev, inner.rev);
  return rev;
}

function pendingIds(blocks: ProseBlock[]): Set<CharId> {
  const ids = new Set<CharId>();
  for (const { block } of walkBlocks(blocks)) if (block.type === 'pending') ids.add(block.id);
  return ids;
}

function mergeResults(results: OpResult[]): OpResult {
  if (results.length === 1) return results[0]!;
  const touched = new Set<CharId>();
  const removed = new Set<CharId>();
  for (const result of results) {
    for (const id of result.removed) {
      touched.delete(id);
      removed.add(id);
    }
    for (const id of result.touched) {
      removed.delete(id);
      touched.add(id);
    }
  }
  return { changed: results.some((result) => result.changed), touched: [...touched], removed: [...removed] };
}

function nextMint(from: number, used: readonly CharId[], session: string): number {
  let next = from;
  for (const id of used) {
    const parsed = parseCharId(id);
    if (parsed?.session === session && parsed.clock >= next) next = parsed.clock + 1;
  }
  return next;
}

/** chip 的样子（日期、提及、下拉、图片）：判断 `as:'markdown'` 有没有丢掉它。 */
function chipSignature(item: InlineItem): string | undefined {
  switch (item.kind) {
    case 'date':
      return `date:${item.value}`;
    case 'mention':
      return `mention:${item.user ?? ''}:${item.ref ?? ''}`;
    case 'dropdown':
      return `dropdown:${item.enum}:${item.index ?? ''}`;
    case 'media':
      return `media:${item.blob}`;
    default:
      return undefined;
  }
}

function chipCounts(blocks: ProseBlock[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { block } of walkBlocks(blocks)) {
    if (!isTextBlock(block)) continue;
    for (const item of block.items) {
      const signature = chipSignature(item);
      if (signature) counts.set(signature, (counts.get(signature) ?? 0) + 1);
    }
  }
  return counts;
}

function tableShape(table: TableBlock): { rows: number; cols: number } {
  return { rows: table.children.length, cols: Math.max(0, ...table.children.map((row) => (row as TableRowBlock).children.length)) };
}

function locateCell(table: TableBlock, row: number, col: number): { row: TableRowBlock; cell: CellBlock } | undefined {
  const rows = table.children as TableRowBlock[];
  const rowBlock = rows[row < 0 ? rows.length + row : row];
  if (!rowBlock) return undefined;
  const cells = rowBlock.children as CellBlock[];
  const cell = cells[col < 0 ? cells.length + col : col];
  return cell ? { row: rowBlock, cell } : undefined;
}

/** 在文字块里找原文：不跨 chip、换行与块；返回每处的首尾字。`fold` 时不分大小写（搜索用）。 */
export function searchText(blocks: ProseBlock[], needle: string, fold = false): SearchHit[] {
  const hits: SearchHit[] = [];
  const wanted = fold ? needle.toLowerCase() : needle;
  if (!wanted) return hits;
  for (const { block } of walkBlocks(blocks)) {
    if (!isTextBlock(block)) continue;
    let run: CharItem[] = [];
    const scan = () => {
      if (run.length) scanRun(block, run, wanted, fold, hits);
      run = [];
    };
    for (const item of block.items) {
      if (item.kind === 'char') run.push(item);
      else scan();
    }
    scan();
  }
  return hits;
}

function scanRun(block: TextBlock, run: CharItem[], needle: string, fold: boolean, hits: SearchHit[]): void {
  const starts = new Map<number, number>();
  const ends = new Map<number, number>();
  let haystack = '';
  run.forEach((item, index) => {
    starts.set(haystack.length, index);
    haystack += item.char;
    ends.set(haystack.length, index);
  });
  const folded = fold ? haystack.toLowerCase() : haystack;
  const source = folded.length === haystack.length ? folded : haystack;
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at < 0) return;
    const first = starts.get(at);
    const last = ends.get(at + needle.length);
    if (first === undefined || last === undefined) {
      from = at + 1;
      continue;
    }
    hits.push({ block, from: run[first]!.id, to: run[last]!.id });
    from = at + needle.length;
  }
}

/** 一次正文调用的目标解析：find / cell → 块或字，查 id 在不在，判断被删掉的块。 */
class Targets {
  readonly #door: DocDoor;
  readonly #node: LiveNode;

  constructor(door: DocDoor, node: LiveNode) {
    this.#door = door;
    this.#node = node;
  }

  /** 块在不在：不在时区分「这份文档里有过、被删了」（`block_gone`，`op: remove`）与「从来没有」（`absent`）。 */
  requireBlock(blocks: ProseBlock[], id: CharId): BlockLocation {
    const found = findBlock(blocks, id);
    if (found) return found;
    const parsed = parseCharId(id);
    const session = parsed ? this.#door.doc.meta.sessions[parsed.session] : undefined;
    if (session && parsed!.clock < session.next)
      refuse('block_gone', `块 ${id} 已经不在了（被删掉了）：他们不要它，不要重建`, { id, op: 'remove', rev: this.#node.rev });
    refuse('absent', `这份正文里没有块 ${id}：用这份文档读到的完整 id，不要照抄示例`, { id });
  }

  cell(blocks: ProseBlock[], target: unknown): CellBlock {
    if (!isRecord(target) || target['kind'] !== 'cell') refuse('invalid_argument', '单元格目标是 {"kind":"cell","table":"<表 id>","row":0,"col":0}');
    const tableId = fullId(target['table'], 'table');
    const table = this.requireBlock(blocks, tableId).block;
    if (table.type !== 'table') refuse('invalid_argument', `块 ${tableId} 不是表格`, { id: tableId });
    const row = intOf(target['row'], 'row', -100_000);
    const col = intOf(target['col'], 'col', -100_000);
    const located = locateCell(table, row, col);
    if (!located) {
      const shape = tableShape(table);
      refuse('cell_none', `表格 ${tableId} 有 ${shape.rows} 行、${shape.cols} 列：按它现在的形状重发`, { table: tableId, ...shape });
    }
    return located.cell;
  }

  find(blocks: ProseBlock[], target: Record<string, unknown>, multiple = target['allowMultiple'] === true): SearchHit[] {
    const text = target['text'];
    if (typeof text !== 'string' || !text) refuse('invalid_argument', 'find 要有 text：文档里原样的字');
    if (text.length > FIND_TEXT_MAX) refuse('invalid_argument', `find 的 text 最多 ${FIND_TEXT_MAX} 个字符：引用几个能认出它的词`);
    let scope = blocks;
    if (target['within'] !== undefined) scope = [this.cell(blocks, target['within'])];
    else if (target['parentId'] !== undefined) {
      const id = fullId(target['parentId'], 'parentId');
      this.requireBlock(blocks, id);
      scope = sectionBlocks(blocks, id) ?? [];
    }
    const hits = searchText(scope, text);
    if (!hits.length) refuse('find_none', `找不到「${text}」：照抄上次读到或回执里的原文（不跨换行、chip 与块），或先读那个块`, { text });
    if (target['nth'] !== undefined) {
      const nth = intOf(target['nth'], 'nth', 1);
      const hit = hits[nth - 1];
      if (!hit) refuse('find_none', `「${text}」只出现了 ${hits.length} 次`, { text, count: hits.length });
      return [hit];
    }
    if (multiple) {
      if (hits.length > FIND_LIMIT) refuse('find_too_many', `「${text}」出现了 ${hits.length} 次，一次最多 ${FIND_LIMIT} 处`, { text, count: hits.length, limit: FIND_LIMIT });
      return hits;
    }
    if (hits.length > 1) refuse('find_ambiguous', `「${text}」出现了 ${hits.length} 次：加 "nth"（从 1 起）或 "parentId"，或引用更长的原文`, { text, count: hits.length });
    return hits;
  }

  /** 目标 → 正文编辑认的目标。`findAs` = 'blocks' 时 find 选中所在的块（move 这类整块的 op）。 */
  resolve(blocks: ProseBlock[], target: unknown, findAs: 'chars' | 'blocks' = 'chars'): Record<string, unknown> {
    if (!isRecord(target)) refuse('invalid_argument', 'op 要有 target：{"kind":"find"|"blocks"|"cell"|"root",…}');
    switch (target['kind']) {
      case 'root':
        return { kind: 'root' };
      case 'blocks': {
        const ids = target['ids'];
        if (!Array.isArray(ids) || ids.length === 0) refuse('invalid_argument', 'blocks 目标要有 ids：块的完整 id');
        const full = ids.map((id) => fullId(id, 'target.ids'));
        for (const id of full) {
          if (!findBlock(blocks, id) && findItem(blocks, id))
            refuse('invalid_argument', `${id} 是字符 id（<text id=…> 里的），不是块：引用它的文字用 find`, { id });
          this.requireBlock(blocks, id);
        }
        return { kind: 'blocks', ids: full };
      }
      case 'chars': {
        const runs = Array.isArray(target['runs']) ? target['runs'] : Array.isArray(target['range']) ? [target['range']] : [];
        if (!runs.length) refuse('invalid_argument', 'chars 目标要有 range：[首字 id, 尾字 id]');
        const checked = runs.map((run) => {
          if (!Array.isArray(run) || run.length !== 2) refuse('invalid_argument', 'chars 的 range 是 [首字 id, 尾字 id]');
          const pair = [fullId(run[0], 'range'), fullId(run[1], 'range')] as [CharId, CharId];
          for (const id of pair) if (!findItem(blocks, id)) refuse('char_gone', `字 ${id} 已经不在了：读那个块，照它现在的字引用`, { id });
          return pair;
        });
        return { kind: 'chars', runs: checked };
      }
      case 'cell':
        return { kind: 'blocks', ids: [this.cell(blocks, target).id] };
      case 'find': {
        const hits = this.find(blocks, target);
        const select = target['select'];
        if (select === 'cells') {
          const cells = hits.map((hit) => {
            const location = findBlock(blocks, hit.block.id)!;
            const cell = [...location.ancestors].reverse().find((ancestor) => ancestor.type === 'cell');
            if (!cell) refuse('invalid_argument', `「${String(target['text'])}」不在表格里：select "cells" 只选单元格`);
            return cell.id;
          });
          return { kind: 'blocks', ids: [...new Set(cells)] };
        }
        if (select === 'blocks' || findAs === 'blocks') return { kind: 'blocks', ids: [...new Set(hits.map((hit) => hit.block.id))] };
        return { kind: 'chars', runs: hits.map((hit) => [hit.from, hit.to]) };
      }
      default:
        refuse('invalid_argument', `不认识的目标 ${JSON.stringify(target['kind'])}：用 find、blocks、cell 或 root`);
    }
  }
}

/** `insert` 的 `source`、`replace` 的 `with`：`{from:{kind:'inline',content}, as}`。 */
function sourceOf(value: unknown, field: 'source' | 'with'): InlineSource {
  if (typeof value === 'string') refuse('invalid_argument', `${field} 要是 {"from":{"kind":"inline","content":"…"},"as":"markdown"|"text"}，不是字符串`);
  if (!isRecord(value)) refuse('invalid_argument', `${field === 'source' ? 'insert 要有 source' : 'replace 要有 with'}：{"from":{"kind":"inline","content":"…"},"as":…}`);
  const from = value['from'];
  if (!isRecord(from)) {
    if (typeof value['text'] === 'string') return { from: { kind: 'inline', content: value['text'] }, as: 'text' };
    refuse('invalid_argument', `${field}.from 永远是 {"kind":"inline","content":"…"}（不是 ${field}.content 或裸字符串）`);
  }
  if (from['kind'] === 'blob') refuse('invalid_argument', `${field}.from 用 {"kind":"inline","content":"…"}；图片先 docs_upload，再在 markdown 里写 ![说明](blob/<id>)`);
  if (from['kind'] !== 'inline' || (typeof from['content'] !== 'string' && !Array.isArray(from['content'])))
    refuse('invalid_argument', `${field}.from 是 {"kind":"inline","content":"…"}`);
  const as = value['as'] ?? 'markdown';
  if (as !== 'text' && as !== 'markdown' && as !== 'blocks' && as !== 'inline') refuse('invalid_argument', `${field}.as 是 "markdown"、"text" 或 "blocks"`);
  const blocks = value['blocks'];
  if (blocks !== undefined && (!isRecord(blocks) || Object.keys(blocks).length === 0)) refuse('invalid_argument', 'blocks 是一张不为空的 chip 表 {"<key>":{"type":…}}，放在 from 旁边');
  return { from: { kind: 'inline', content: from['content'] as string | WireNode[] }, as, ...(blocks ? { blocks } : {}) };
}

function inlineContent(source: InlineSource): string | WireNode[] {
  return (source.from as { content: string | WireNode[] }).content;
}

const CELL_TYPES = new Set(['cell', 'tableCell', 'tableHeader', 'td', 'th']);
const BLOCK_WIRE_TYPES = new Set(['paragraph', 'heading', 'codeBlock', 'list', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'table', 'tableRow', 'row', 'horizontalRule', 'rule', 'pending', 'embed', ...CELL_TYPES]);

interface Notice {
  code: string;
  [key: string]: unknown;
}

/** 一次正文调用的回执。 */
export interface NodeAck {
  rev: number;
  session: string;
  xml: string;
  changed: boolean;
  notices?: Notice[];
}

/** 智能体改一份正文（一次调用的全部 op）：逐条解析目标、检查、应用，最后一起落下（一个新 rev）。 */
class NodeEdit {
  readonly #door: DocDoor;
  readonly #node: LiveNode;
  readonly #ctx: DoorContext;
  readonly #targets: Targets;
  /** 已经插过的落点（同一处插两次会颠倒顺序）。 */
  readonly #anchors = new Set<string>();

  constructor(door: DocDoor, node: LiveNode, ctx: DoorContext) {
    this.#door = door;
    this.#node = node;
    this.#ctx = ctx;
    this.#targets = new Targets(door, node);
  }

  run(payload: Record<string, unknown>): NodeAck {
    const ops = payload['ops'];
    if (!Array.isArray(ops) || ops.length === 0) refuse('invalid_argument', '改正文要 payload.ops：非空的 op 数组');
    if (ops.length > OPS_LIMIT) refuse('too_many', `一次最多 ${OPS_LIMIT} 个 op`, { dim: 'ops', limit: OPS_LIMIT });
    ops.forEach((op, index) => {
      if (!isRecord(op) || typeof op['op'] !== 'string') refuse('invalid_argument', `第 ${index} 个 op 要是 {"op":…}`, { index });
    });
    const records = ops as Record<string, unknown>[];
    if (records.some((op) => op['op'] === 'restore')) return this.#restore(records, payload);

    const node = this.#node;
    const initial = node.blocks;
    const options = this.#door.nodeOptions(node, this.#ctx);
    const session = options.mintSession;
    let mintFrom = options.mintFrom;
    let blocks = initial;
    const results: OpResult[] = [];
    const usedIds: CharId[] = [];
    const detached = new Set<string>();
    for (const [index, op] of records.entries()) {
      try {
        this.#guard(op, initial);
        const translated = this.#translate(op, blocks);
        if (!translated.length) {
          results.push({ changed: false, touched: [], removed: [] });
          continue;
        }
        const outcome = applyProseOps(blocks, translated, { ...options, mintFrom });
        if (!outcome.ok) refuse(agentCode(outcome.reason), outcome.detail ?? outcome.reason, { ...(outcome.data ?? {}) });
        if (op['op'] === 'replace') this.#checkDropped(blocks, outcome.blocks);
        for (const id of this.#detaching(blocks, outcome.blocks, op['allowDetach'] === true)) detached.add(id);
        mintFrom = nextMint(mintFrom, outcome.usedIds, session);
        blocks = outcome.blocks;
        results.push(mergeResults(outcome.results));
        usedIds.push(...outcome.usedIds);
      } catch (error) {
        if (error instanceof DocsRefusal) throw withIndex(error, index);
        throw error;
      }
    }
    if (!results.some((result) => result.changed)) {
      return { rev: node.rev, session, xml: ackXml(blocks, results.map(() => []), xmlContext(this.#door, node)), changed: false };
    }
    const notices: Notice[] = [];
    const after = pendingIds(blocks);
    for (const id of pendingIds(initial)) if (!after.has(id)) notices.push({ code: 'pending_ended', id });
    if (detached.size) notices.push({ code: 'detached', threads: [...detached], message: '这些评论线程保持打开，挂着的字没了：告诉用户' });
    this.#door.commitNodeBlocks(node, blocks, usedIds, results, session, this.#ctx);
    const xml = ackXml(
      blocks,
      results.map((result) => result.touched),
      xmlContext(this.#door, node),
    );
    return { rev: node.rev, session, xml, changed: true, ...(notices.length ? { notices } : {}) };
  }

  /** 整块写的 guard：按这次调用第一个 op 之前的文档判断。 */
  #guard(op: Record<string, unknown>, initial: ProseBlock[]): void {
    if (op['op'] !== 'replace' && op['op'] !== 'delete') return;
    const ifRev = op['ifRev'];
    if (ifRev !== undefined) {
      intOf(ifRev, 'ifRev');
      if ((ifRev as number) > this.#node.rev) refuse('guard_mismatch', `ifRev ${String(ifRev)} 比正文现在的 rev ${this.#node.rev} 还新：用读的结果里的 rev`, { rev: this.#node.rev });
    }
    if (op['force'] === true) return;
    const target = op['target'];
    if (!isRecord(target)) return;
    const rev = ifRev as number | undefined;
    if (target['kind'] === 'blocks' && Array.isArray(target['ids'])) {
      const ids = target['ids'].filter(isCharId);
      if (ids.length !== target['ids'].length) return;
      const located = ids.map((id) => findBlock(initial, id));
      if (located.some((location) => !location)) return;
      const picked = located.map((location) => location!.block);
      if (op['op'] === 'replace' && picked.length === 1 && picked[0]!.type === 'pending') return;
      if (picked.length === 1) {
        const block = picked[0]!;
        if (op['ifHash'] === undefined || rev === undefined)
          refuse('missing_guard', '整块的 replace / delete 要在 "op" 旁边带 "ifHash"（它最新的 h）与 "ifRev"（显示它的那次读的 rev）；被要求覆盖时 "force":true', {
            id: block.id,
          });
        if (op['ifHash'] !== blockHash(block)) this.#mismatch(initial, [block]);
        return;
      }
      if (rev === undefined) refuse('missing_guard', '多个块的 replace / delete 要带 "ifRev"（显示它们的那次读的 rev）', { ids });
      const changed = picked.filter((block) => subtreeRev(block) > rev);
      if (changed.length) this.#mismatch(initial, changed);
      return;
    }
    if (target['kind'] === 'cell') {
      if (rev === undefined) refuse('missing_guard', '整个单元格的 replace 要带 "ifRev"（这一行或列来自的那次读的 rev，不是之后回执的）');
      const tableId = target['table'];
      const table = isCharId(tableId) ? findBlock(initial, tableId)?.block : undefined;
      if (table?.type !== 'table' || typeof target['row'] !== 'number' || typeof target['col'] !== 'number') return;
      const located = locateCell(table, target['row'], target['col']);
      if (!located) return;
      if (table.rev > rev || located.row.rev > rev) this.#mismatch(initial, [table], { shape: tableShape(table) });
      return;
    }
    if (target['kind'] === 'find' && (target['select'] === 'blocks' || target['select'] === 'cells')) {
      if (rev === undefined) refuse('missing_guard', 'find 选中整块或单元格（select）时要带 "ifRev"（那次读的 rev）');
      const resolved = this.#targets.resolve(initial, target);
      const picked = (resolved['ids'] as CharId[]).map((id) => findBlock(initial, id)!.block);
      const changed = picked.filter((block) => subtreeRev(block) > rev);
      if (changed.length) this.#mismatch(initial, changed);
    }
  }

  #mismatch(initial: ProseBlock[], blocks: ProseBlock[], extra: Record<string, unknown> = {}): never {
    const first = blocks[0]!;
    refuse('guard_mismatch', `块 ${first.id} 在你读过之后被改了：他们的改动算数，按它现在的样子重新瞄准（guard 用这里的 h 与 rev）`, {
      id: first.id,
      h: blockHash(first),
      rev: this.#node.rev,
      xml: blocksXml(initial, blocks, xmlContext(this.#door, this.#node)),
      ...extra,
    });
  }

  /** 智能体的 op → 正文编辑的 op（可能是几条，也可能是零条：没有改动）。 */
  #translate(raw: Record<string, unknown>, blocks: ProseBlock[]): ProseOp[] {
    const { ifHash: _ifHash, ifRev: _ifRev, force: _force, allowDetach: _allowDetach, each, ...op } = raw;
    switch (op['op']) {
      case 'insert':
        return this.#insert(op, blocks, each === true);
      case 'replace':
        return this.#replace(op, blocks);
      case 'move': {
        const to = isRecord(op['to']) ? op['to'] : undefined;
        if (!to) refuse('invalid_argument', 'move 要有 to：{"target":…,"side":"before"|"after"|"start"|"end"}');
        return [
          {
            ...op,
            target: this.#targets.resolve(blocks, op['target'], 'blocks'),
            to: { ...to, target: this.#targets.resolve(blocks, to['target'], 'blocks') },
          } as unknown as ProseOp,
        ];
      }
      case 'restore':
        refuse('invalid_argument', 'restore 要单独一次调用（ops 里只有它）');
      // eslint-disable-next-line no-fallthrough
      default:
        if ('target' in op) return [{ ...op, target: this.#targets.resolve(blocks, op['target']) } as ProseOp];
        return [op as ProseOp];
    }
  }

  #insert(op: Record<string, unknown>, blocks: ProseBlock[], each: boolean): ProseOp[] {
    const source = sourceOf(op['source'], 'source');
    const target = op['target'];
    if (isRecord(target) && target['kind'] === 'blocks' && Array.isArray(target['ids']) && target['ids'].length > 1) {
      if (!each) refuse('place_arity', 'insert 的落点只能是一个块：多个 id 要带 "each":true（每个块旁各放一份）', { count: target['ids'].length });
      if (target['ids'].length > EACH_LIMIT) refuse('too_many', `"each" 一次最多 ${EACH_LIMIT} 份`, { dim: 'each', limit: EACH_LIMIT });
      const ids = target['ids'].map((id) => fullId(id, 'target.ids'));
      const twice = ids.find((id, index) => ids.indexOf(id) !== index);
      if (twice) refuse('same_anchor', `id ${twice} 出现了两次：每个落点只放一份`, { id: twice });
      return ids.map((id) => this.#insertOne({ ...op, target: { kind: 'blocks', ids: [id] } }, source, blocks, true));
    }
    return [this.#insertOne(op, source, blocks, each)];
  }

  #insertOne(op: Record<string, unknown>, source: InlineSource, blocks: ProseBlock[], each: boolean): ProseOp {
    const side = op['side'] ?? 'after';
    if (side !== 'before' && side !== 'after' && side !== 'start' && side !== 'end') refuse('invalid_argument', 'side 是 "before"、"after"、"start" 或 "end"');
    let target = this.#targets.resolve(blocks, op['target']);
    let placed = side as string;
    let content = source;
    if (!each && (side === 'after' || side === 'start')) {
      const key = JSON.stringify([target, side]);
      if (this.#anchors.has(key)) refuse('same_anchor', '同一处插了两次（后一次会排到前一次前面）：合成一个 insert，或插在前一次写下的块后面');
      this.#anchors.add(key);
    }
    if (target['kind'] === 'blocks') {
      const anchor = findBlock(blocks, (target['ids'] as CharId[])[0]!)!;
      const block = anchor.block;
      if (side === 'end' && block.type === 'paragraph' && block.heading && isBlockSource(source)) {
        // 标题 + "end" = 那一节的末尾
        const section = sectionBlocks(blocks, block.id) ?? [block];
        target = { kind: 'blocks', ids: [section.at(-1)!.id] };
        placed = 'after';
      } else if ((block.type === 'tableRow' && (side === 'start' || side === 'end')) || (block.type === 'cell' && (side === 'before' || side === 'after'))) {
        content = this.#cellSource(source, blocks, block.type === 'tableRow' ? anchor : findBlock(blocks, anchor.parent!.id)!);
      }
    }
    return { op: 'insert', target, side: placed, source: content } as ProseOp;
  }

  /** 表格加列：每份内容放进一个单元格（表头行得到表头单元格）。 */
  #cellSource(source: InlineSource, blocks: ProseBlock[], rowLocation: BlockLocation): InlineSource {
    const content = inlineContent(source);
    if (Array.isArray(content) && content.length > 0 && content.every((node) => isRecord(node) && CELL_TYPES.has(String(node.type)))) return source;
    const row = rowLocation.block as TableRowBlock;
    const table = rowLocation.parent as TableBlock | undefined;
    const header = table?.children[0] === row && row.children.length > 0 && row.children.every((cell) => (cell as CellBlock).header);
    let children: WireNode[];
    if (source.as === 'markdown' && typeof content === 'string') children = content.trim() ? markdownToWire(content, source.blocks as Record<string, WireNode> | undefined) : [{ type: 'paragraph' }];
    else if (typeof content === 'string') children = [{ type: 'paragraph', ...(content ? { content: [{ type: 'text', text: content }] } : {}) }];
    else children = content.every((node) => !BLOCK_WIRE_TYPES.has(node.type)) ? [{ type: 'paragraph', content }] : content;
    return { from: { kind: 'inline', content: [{ type: 'cell', attrs: header ? { header: true } : {}, content: children }] }, as: 'blocks' };
  }

  #replace(op: Record<string, unknown>, blocks: ProseBlock[]): ProseOp[] {
    const source = sourceOf(op['with'], 'with');
    const target = this.#targets.resolve(blocks, op['target']);
    const content = inlineContent(source);
    if (source.as === 'text' && target['kind'] === 'blocks' && typeof content === 'string') {
      const ids = target['ids'] as CharId[];
      if (ids.length === 1) {
        const block = findBlock(blocks, ids[0]!)!.block;
        const texts = [...walkBlocks([block])].map((location) => location.block).filter(isTextBlock);
        if (texts.length === 1) {
          const edit = this.#reword(texts[0]!, content);
          return edit ? [edit] : [];
        }
        if (texts.length > 1)
          refuse('invalid_op', `"as":"text" 只改一个文字块，${block.id} 里有 ${texts.length} 个：用 find 引用要改的字，或读它之后用 "as":"markdown" 重写`, { id: block.id });
      }
    }
    return [{ op: 'replace', target, with: source } as ProseOp];
  }

  /** `as:'text'` 的整块改写：只换掉变了的那段字，chip、换行、格式与评论锚点都留着。 */
  #reword(block: TextBlock, next: string): ProseOp | undefined {
    if (/[\r\n]/.test(next)) refuse('invalid_op', '"as":"text" 不能带换行：多段内容用 "as":"markdown"');
    const items = block.items;
    const unit = (item: InlineItem) => (item.kind === 'char' ? item.char : '￼');
    let prefix = 0;
    let offset = 0;
    while (prefix < items.length && next.startsWith(unit(items[prefix]!), offset)) {
      offset += unit(items[prefix]!).length;
      prefix++;
    }
    let suffix = 0;
    let end = next.length;
    while (suffix < items.length - prefix) {
      const text = unit(items[items.length - 1 - suffix]!);
      if (end - text.length < offset || next.slice(end - text.length, end) !== text) break;
      end -= text.length;
      suffix++;
    }
    const removed = items.slice(prefix, items.length - suffix);
    const inserted = next.slice(offset, end);
    if (removed.some((item) => item.kind !== 'char'))
      refuse('invalid_op', `改动的字里有 chip 或换行：用 find 引用它两边的字分别改（块 ${block.id}）`, { id: block.id });
    const text: InlineSource = { from: { kind: 'inline', content: inserted }, as: 'text' };
    if (!removed.length) {
      if (!inserted) return undefined;
      if (prefix > 0) return { op: 'insert', target: { kind: 'chars', range: [items[prefix - 1]!.id, items[prefix - 1]!.id] }, side: 'after', source: text };
      if (items.length) return { op: 'insert', target: { kind: 'chars', range: [items[0]!.id, items[0]!.id] }, side: 'before', source: text };
      return { op: 'insert', target: { kind: 'blocks', ids: [block.id] }, side: 'end', source: text };
    }
    const range: [CharId, CharId] = [removed[0]!.id, removed.at(-1)!.id];
    if (!inserted) return { op: 'delete', target: { kind: 'chars', range } };
    return { op: 'replace', target: { kind: 'chars', range }, with: text };
  }

  /** `replace` 丢掉了原来的 chip（没在新内容里重新写出）→ `dropped`。 */
  #checkDropped(before: ProseBlock[], after: ProseBlock[]): void {
    const was = chipCounts(before);
    const now = chipCounts(after);
    const lost = [...was].filter(([signature, count]) => (now.get(signature) ?? 0) < count).map(([signature]) => signature);
    if (lost.length)
      refuse('dropped', `这次 replace 会丢掉 ${lost.length} 种 chip（${lost.slice(0, 5).join('、')}）：先读它（view + parentId），在 markdown 里用 <?claude block k?> 重新写出，或改用 "as":"text"`, {
        chips: lost,
      });
  }

  /** 这条 op 让哪些评论整段脱钩（挂着的字一个不剩）。没带 `allowDetach` 时拒绝；带了也不能动别人写过的线程。 */
  #detaching(before: ProseBlock[], after: ProseBlock[], allowDetach: boolean): string[] {
    const lost: string[] = [];
    const others: string[] = [];
    const me = this.#door.user.principal;
    for (const thread of this.#door.doc.threads) {
      if (thread.nodeId !== this.#node.id || thread.resolved || !thread.anchor) continue;
      const covered = anchoredIds(before, thread.anchor.from, thread.anchor.to);
      if (!covered.length || covered.some((id) => findItem(after, id))) continue;
      lost.push(thread.id);
      const authors = [thread.author, ...thread.replies.map((reply) => reply.author)];
      if (authors.some((author) => author.channel === 'human' && author.principal !== me)) others.push(thread.id);
    }
    if (lost.length && !allowDetach)
      refuse('anchors_affected', '这次改动会删掉评论挂着的全部字：收窄改动绕开它们；只有人明确要求删时，才在这个 op 上加 "allowDetach":true', { threads: lost });
    if (others.length) refuse('anchors_affected', '别人写过的评论线程挂在这些字上：在线程里提议，由他们决定', { threads: others });
    return lost;
  }

  /** `restore`：整个标签页倒回某个 rev。只在之后什么都没变时（`payload.ifRev` = 现在的 rev）。 */
  #restore(ops: Record<string, unknown>[], payload: Record<string, unknown>): NodeAck {
    const node = this.#node;
    if (ops.length !== 1) refuse('invalid_argument', 'restore 要单独一次调用（ops 里只有它）');
    const op = ops[0]!;
    const rev = intOf(op['rev'], 'restore 的 rev', 1);
    if (payload['ifRev'] === undefined) refuse('missing_guard', 'restore 要带 payload.ifRev = atRev 读给出的 latest', { rev: node.rev });
    const ifRev = intOf(payload['ifRev'], 'ifRev');
    if (ifRev !== node.rev)
      refuse('guard_mismatch', `正文在 rev ${ifRev} 之后又变了（现在是 ${node.rev}）：用 atRev 读出要的字，再用 insert 插回去`, { rev: node.rev });
    if (rev >= node.rev) refuse('invalid_argument', `rev ${rev} 不在过去：现在是 ${node.rev}`);
    const snapshot = this.#door.doc.snapshot(node, rev);
    if (!snapshot) refuse('absent', `rev ${rev} 已不在历史里：还留着 ${this.#door.doc.oldestRev(node)}–${node.rev}`, { oldest: this.#door.doc.oldestRev(node), latest: node.rev });
    this.#detaching(node.blocks, snapshot, op['allowDetach'] === true);
    const session = this.#door.nodeOptions(node, this.#ctx).mintSession;
    this.#door.restoreNode(node, snapshot, rev, this.#ctx);
    const xml = docXml(node.blocks, xmlContext(this.#door, node), { outline: true });
    return { rev: node.rev, session, xml, changed: true, notices: [{ code: 'restored', from: rev }] };
  }
}

/** 正文的读：大纲、一节（`parentId`）、搜索、版本、某个 rev 以来的变化、某个 rev 时的样子，或整篇。 */
function readNode(door: DocDoor, node: LiveNode, payload: Record<string, unknown> | undefined): Result {
  const context = xmlContext(door, node);
  const p = payload ?? {};
  const outline = () => ({ rev: node.rev, xml: docXml(node.blocks, context, { outline: true }) });
  if (p['projection'] === 'outline') return outline();
  if (p['kind'] === 'search') {
    const text = p['text'];
    if (typeof text !== 'string' || !text.trim()) refuse('invalid_argument', 'search 要有 text');
    const hits = searchText(node.blocks, text, true);
    return { rev: node.rev, hits: hits.length, xml: searchXml(hits.slice(0, SEARCH_LIMIT), context, text), ...(hits.length > SEARCH_LIMIT ? { truncated: true } : {}) };
  }
  if (p['kind'] === 'versions') return { rev: node.rev, versions: listVersions(node) };
  if (p['kind'] !== undefined && p['kind'] !== 'view')
    refuse('invalid_argument', 'payload 是 {"projection":"outline"}、{"kind":"view",…}、{"kind":"search","text"} 或 {"kind":"versions"}');
  if (p['atRev'] !== undefined) {
    const rev = intOf(p['atRev'], 'atRev', 1);
    if (rev > node.rev) refuse('invalid_argument', `rev ${rev} 还没有：现在是 ${node.rev}`, { latest: node.rev });
    const blocks = rev === node.rev ? node.blocks : door.doc.snapshot(node, rev);
    if (!blocks) refuse('absent', `rev ${rev} 已不在历史里：还留着 ${door.doc.oldestRev(node)}–${node.rev}`, { oldest: door.doc.oldestRev(node), latest: node.rev });
    return { rev, latest: node.rev, xml: docXml(blocks, { ...context, rev, threads: [] }) };
  }
  if (p['sinceRev'] !== undefined) {
    const since = intOf(p['sinceRev'], 'sinceRev');
    if (since > node.rev) refuse('invalid_argument', `rev ${since} 还没有：现在是 ${node.rev}`, { latest: node.rev });
    const before = since === node.rev ? node.blocks : door.doc.snapshot(node, since);
    return { rev: node.rev, since, xml: sinceXml(node.blocks, before, since, context) };
  }
  if (p['parentId'] !== undefined) {
    const id = fullId(p['parentId'], 'parentId');
    const picked = sectionBlocks(node.blocks, id);
    if (!picked) new Targets(door, node).requireBlock(node.blocks, id);
    return { rev: node.rev, xml: blocksXml(node.blocks, picked!, context, { parentId: id }) };
  }
  const xml = docXml(node.blocks, context);
  if (xml.length > FULL_READ_MAX) return { ...outline(), truncated: true, next: '整篇太长，这是大纲：用 {"kind":"view","parentId"} 读一节，或 {"kind":"search","text"}' };
  return { rev: node.rev, xml };
}

function tabOrder(a: DocTab, b: DocTab): number {
  if (a.order && b.order) return a.order < b.order ? -1 : a.order > b.order ? 1 : 0;
  return a.order ? -1 : b.order ? 1 : 0;
}

/** 文档本身的读：标签页（files）与各自正文的 id、标签栏、下拉选项。 */
function readProject(doc: LiveDoc): Result {
  const meta = doc.meta;
  const visible = visibleTabs(meta).sort(tabOrder);
  const hidden = meta.tabs.filter((tab) => tab.hidden);
  return {
    id: meta.id,
    name: meta.name,
    rev: meta.rev,
    files: [...visible, ...hidden].map((tab) => ({
      id: tab.id,
      name: tab.name,
      ...(tab.order ? { order: tab.order } : {}),
      ...(tab.subtabOf ? { subtabOf: tab.subtabOf } : {}),
      ...(tab.hidden ? { hidden: true } : {}),
      ...(tab.nodeId ? { content: { kind: 'node', id: tab.nodeId, engine: 'prose' } } : {}),
    })),
    tabs: projectValue(meta).tabs,
    ...(Object.keys(meta.enums).length ? { enums: Object.entries(meta.enums).map(([id, value]) => ({ id, ...value })) } : {}),
    openThreads: doc.threads.filter((thread) => !thread.resolved).length,
  };
}

/** 一条成员的结果（给智能体）：正文改动是它的回执，其余是 id / rev / value。 */
function shape(verdict: DoorAllow): Result {
  const out: Result = {};
  if (verdict.minted) out['id'] = verdict.minted;
  if (verdict.rev !== undefined) out['rev'] = verdict.rev;
  if (verdict.value !== undefined) out['value'] = verdict.value;
  if (verdict.data !== undefined) Object.assign(out, isRecord(verdict.data) ? verdict.data : { data: verdict.data });
  if (verdict.changed && out['changed'] === undefined) out['changed'] = true;
  return out;
}

/** 新建时 markdown 里每个 chip 的 key → 它写下的块或元素的 id（待填块、日期、提及、下拉）。 */
function chipKeys(markdown: string, chips: Record<string, unknown> | undefined, blocks: ProseBlock[]): Record<string, string> {
  if (!chips) return {};
  const queues = new Map<string, CharId[]>();
  const push = (kind: string, id: CharId) => queues.set(kind, [...(queues.get(kind) ?? []), id]);
  for (const { block } of walkBlocks(blocks)) {
    if (block.type === 'pending') push('pending', block.id);
    if (isTextBlock(block)) for (const item of block.items) if (item.kind === 'date' || item.kind === 'mention' || item.kind === 'dropdown') push(item.kind, item.id);
  }
  const keys: Record<string, string> = {};
  for (const match of markdown.matchAll(CHIP_PATTERN)) {
    const key = match[1]!;
    const chip = chips[key];
    const type = isRecord(chip) ? chip['type'] : undefined;
    if (type !== 'pending' && type !== 'date' && type !== 'mention' && type !== 'dropdown') continue;
    const id = queues.get(type)?.shift();
    if (id && !(key in keys)) keys[key] = id;
  }
  return keys;
}

function dropdownLabel(meta: DocMeta, enumId: string, index: number | undefined): string | undefined {
  if (index === undefined) return undefined;
  const options = meta.enums[enumId]?.['options'];
  const option = Array.isArray(options) ? (options[index] as { name?: unknown } | undefined) : undefined;
  return typeof option?.name === 'string' ? option.name : undefined;
}

class Connector implements DocsConnector {
  readonly #host: DocsConnectorHost;

  constructor(host: DocsConnectorHost) {
    this.#host = host;
  }

  async #open(dir: string): Promise<{ doc: LiveDoc; door: DocDoor }> {
    let doc: LiveDoc;
    try {
      doc = await this.#host.doc(dir);
    } catch {
      refuse('absent', '这个目录不是文档（没有合格的 doc.json）');
    }
    if (doc.gone) refuse('absent', '文档已经不在了（目录被删掉或挪走）');
    return { doc, door: this.#host.door(doc) };
  }

  /** 一个成员：正文改动、评论锚点、新正文的回执由连接器处理，其余交给 door。 */
  #dispatch(door: DocDoor, member: DoorRequest, ctx: DoorContext): DoorVerdict {
    if (!isRecord(member) || typeof member.verb !== 'string') refuse('invalid_argument', '成员是 {"verb","object"|"ref","payload",…}');
    const object = member.ref?.object ?? member.object;
    if (member.engine !== undefined && !['prose', 'json', 'blob'].includes(member.engine))
      refuse('unsupported', `${member.engine} 不支持：BaoCut 的文档没有图表、示意图与 widget，用表格或列表`, { engine: member.engine });
    if (object === 'node' && member.verb === 'update') {
      const node = requireNode(door.doc, member.ref);
      const ack = new NodeEdit(door, node, ctx).run(member.payload ?? {});
      return allow({ rev: ack.rev, changed: ack.changed, data: ack });
    }
    if (object === 'node' && member.verb === 'read') return allow({ data: readNode(door, requireNode(door.doc, member.ref), member.payload) });
    if (object === 'node' && member.verb === 'create') {
      const source = member.payload?.['source'];
      const payload = source === undefined ? member.payload : { ...member.payload, source: sourceOf(source, 'source') };
      const verdict = door.handle({ ...member, ...(payload ? { payload } : {}) }, ctx);
      const node = verdict.verdict === 'allow' && verdict.minted ? door.doc.node(verdict.minted) : undefined;
      if (verdict.verdict === 'allow' && node) verdict.data = { xml: docXml(node.blocks, xmlContext(door, node), { outline: true }) };
      return verdict;
    }
    if (object === 'utterance' && member.verb === 'create') return door.handle(this.#anchor(door, member), ctx);
    return door.handle(member, ctx);
  }

  /** 新评论的锚点：`{kind:'find', text, nth?}` → 那段字的首尾 id。 */
  #anchor(door: DocDoor, member: DoorRequest): DoorRequest {
    const value = member.payload?.['value'];
    if (!isRecord(value) || !isRecord(value['parent']) || value['parent']['object'] !== 'node') return member;
    const parent = value['parent'];
    const node = requireNode(door.doc, parent);
    const anchor = parent['anchor'];
    let range: [CharId, CharId] | undefined;
    if (isRecord(anchor)) {
      if (anchor['kind'] === 'find') {
        const [hit] = new Targets(door, node).find(node.blocks, anchor, false);
        range = [hit!.from, hit!.to];
      } else if (anchor['kind'] === 'chars' && Array.isArray(anchor['range']) && anchor['range'].length === 2) {
        range = [fullId(anchor['range'][0], 'anchor.range'), fullId(anchor['range'][1], 'anchor.range')];
      } else refuse('invalid_argument', 'anchor 是 {"kind":"find","text":"<原文里的 3–6 个词>"}');
    } else if (anchor !== undefined) refuse('invalid_argument', 'anchor 是 {"kind":"find","text":"<原文里的 3–6 个词>"}');
    const nextParent = { object: 'node', id: node.id, ...(range ? { anchor: { kind: 'chars', range } } : {}) };
    return { ...member, payload: { ...member.payload, value: { ...value, parent: nextParent } } };
  }

  /** 单个调用：一个事务，被拒时什么也没改。 */
  #call(door: DocDoor, request: DoorRequest, ctx: DoorContext): DoorAllow {
    const verdict = door.doc.transaction((): DoorVerdict & { commit?: boolean } => {
      const result = this.#dispatch(door, request, ctx);
      return result.verdict === 'deny' ? { ...result, commit: false } : result;
    });
    if (verdict.verdict === 'deny') refuseVerdict(verdict);
    return verdict;
  }

  #runBatch(door: DocDoor, members: unknown, ctx: DoorContext, initial: Record<string, string>) {
    if (!Array.isArray(members)) refuse('invalid_argument', 'batch 要是成员数组（新建时可以是 []）');
    if (members.length > 100) refuse('too_many', '一个 batch 最多 100 个成员', { dim: 'batch', limit: 100 });
    members.forEach((member, index) => {
      if (!isRecord(member) || typeof member['verb'] !== 'string') refuse('invalid_argument', `第 ${index} 个成员要是 {"verb",…}`, { index });
    });
    const verdict = door.handleBatch(members as DoorRequest[], ctx, initial, (member, index) => {
      try {
        return this.#dispatch(door, member, ctx);
      } catch (error) {
        if (error instanceof DocsRefusal) throw withIndex(error, index);
        throw error;
      }
    });
    if (verdict.verdict === 'deny') refuseVerdict(verdict, { index: verdict.index });
    return verdict;
  }

  async batch(dir: string, args: { container: DocsContainer; batch: Record<string, unknown>[] }, actor: DocsActor): Promise<Result> {
    if (isRecord(args.container) && args.container['create'] !== undefined) return this.#birth(dir, args, actor);
    const { doc, door } = await this.#open(dir);
    checkContainer(doc, args.container);
    const result = this.#runBatch(door, args.batch, agentContext(actor), {});
    await doc.flush();
    return { acks: result.acks.map(shape), ...(Object.keys(result.lids).length ? { lids: result.lids } : {}) };
  }

  /** 新建：一份文档（一个标签页 `f`、它的正文 `n`），成员先执行（下拉选项、更多标签页），再把 markdown 写进 `n`。 */
  async #birth(dir: string, args: { container: DocsContainer; batch: Record<string, unknown>[] }, actor: DocsActor): Promise<Result> {
    const create = args.container['create'];
    if (args.container.kind !== 'project' || !isRecord(create)) refuse('invalid_argument', '新建是 container = {"kind":"project","create":{"name","doc":{"markdown","blocks"?}}}');
    const name = create['name'];
    if (typeof name !== 'string' || !name.trim() || name.length > 255) refuse('invalid_argument', 'create.name 是文档标题（1–255 个字符）');
    const body = create['doc'] ?? {};
    if (!isRecord(body)) refuse('invalid_argument', 'create.doc 是 {"markdown":"…","blocks":{…}}');
    const markdown = body['markdown'];
    if (markdown !== undefined && typeof markdown !== 'string') refuse('invalid_argument', 'create.doc.markdown 要是字符串');
    const chips = body['blocks'];
    if (chips !== undefined && (!isRecord(chips) || Object.keys(chips).length === 0)) refuse('invalid_argument', 'create.doc.blocks 是一张不为空的 chip 表');
    if (await readDocInfo(dir)) refuse('exists', '这个目录已经是一份文档：用 container = {"kind":"project","id":"<文档 id>"} 改它');

    const live = this.#host.fresh(dir, newDocState(name.trim()));
    const door = this.#host.door(live);
    const ctx = agentContext(actor);
    const tab = live.meta.tabs[0]!;
    const node = live.node(tab.nodeId!)!;
    const paragraphId = node.blocks[0]!.id;
    const initial = { p: live.id, f: tab.id, n: node.id };
    const outcome = live.transaction(() => {
      const batch = this.#runBatch(door, args.batch ?? [], ctx, initial);
      let ack: NodeAck | undefined;
      let keys: Record<string, string> = {};
      if (markdown?.trim()) {
        let table: Record<string, unknown> | undefined;
        try {
          table = chips ? substituteLids(chips as Record<string, unknown>, batch.lids) : undefined;
        } catch (error) {
          if (error instanceof UnknownLid) refuse('absent', error.message, { lid: error.lid });
          throw error;
        }
        const target = findBlock(node.blocks, paragraphId) ? { kind: 'blocks', ids: [paragraphId] } : { kind: 'root' };
        const op =
          target.kind === 'root'
            ? { op: 'insert', target, side: 'start', source: { from: { kind: 'inline', content: markdown }, as: 'markdown', ...(table ? { blocks: table } : {}) } }
            : { op: 'replace', target, force: true, with: { from: { kind: 'inline', content: markdown }, as: 'markdown', ...(table ? { blocks: table } : {}) } };
        ack = new NodeEdit(door, node, ctx).run({ ops: [op] });
        keys = chipKeys(markdown, table, node.blocks);
      }
      return { batch, ack, keys };
    });
    this.#host.adopt(live);
    await live.flush();
    const n = outcome.ack ?? { rev: node.rev, session: live.meta.mintPrefix ?? '', xml: docXml(node.blocks, xmlContext(door, node), { outline: true }), changed: false };
    return {
      created: { id: live.id, name: live.meta.name },
      container: { kind: 'project', id: live.id },
      lids: outcome.batch.lids,
      n,
      ...(Object.keys(outcome.keys).length ? { keys: outcome.keys } : {}),
      ...(outcome.batch.acks.length ? { acks: outcome.batch.acks.map(shape) } : {}),
    };
  }

  async create(dir: string, args: { object: string; container?: DocsContainer; engine?: string; payload: Record<string, unknown> }, actor: DocsActor): Promise<Result> {
    const { doc, door } = await this.#open(dir);
    checkContainer(doc, args.container);
    const verdict = this.#call(door, { verb: 'create', object: args.object, ...(args.engine ? { engine: args.engine } : {}), payload: args.payload ?? {} }, agentContext(actor));
    await doc.flush();
    return shape(verdict);
  }

  async read(dir: string, args: { ref?: DocsRef; engine?: string; container?: DocsContainer; payload?: Record<string, unknown> }, actor: DocsActor): Promise<Result> {
    const { doc, door } = await this.#open(dir);
    checkContainer(doc, args.container);
    const ref = args.ref;
    if (!ref || ref.object === 'project') {
      if (ref?.id && ref.id.replace(/^project\//, '') !== doc.id) refuse('absent', `${ref.id} 不是这份文档：这份文档的 id 是 ${doc.id}`, { object: 'project', doc: doc.id });
      return readProject(doc);
    }
    if (args.engine !== undefined && !['prose', 'json', 'blob'].includes(args.engine)) refuse('unsupported', `${args.engine} 不支持：BaoCut 的文档没有图表与 widget`);
    if (ref.object === 'node') return readNode(door, requireNode(doc, ref), args.payload);
    const verdict = door.handle({ verb: 'read', ref, ...(args.payload ? { payload: args.payload } : {}) }, agentContext(actor));
    if (verdict.verdict === 'deny') refuseVerdict(verdict);
    return shape(verdict);
  }

  async update(
    dir: string,
    args: { ref: DocsRef; engine?: string; container?: DocsContainer; payload: Record<string, unknown> | string; answering?: string },
    actor: DocsActor,
  ): Promise<Result> {
    const { doc, door } = await this.#open(dir);
    checkContainer(doc, args.container);
    let payload = args.payload;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        refuse('invalid_argument', 'payload 要是对象：{"ops":[…]} 或 {"kind":"patch","patch":[…]}');
      }
      if (!isRecord(payload)) refuse('invalid_argument', 'payload 要是对象');
    }
    if (args.answering !== undefined && !door.threadOf(args.answering)) refuse('absent', `answering 要是这份文档里一个评论线程的 id（${args.answering} 不是）`, { object: 'utterance' });
    const request: DoorRequest = { verb: 'update', ref: args.ref, ...(args.engine ? { engine: args.engine } : {}), payload };
    const verdict = this.#call(door, request, agentContext(actor, args.answering));
    await doc.flush();
    return shape(verdict);
  }

  async query(dir: string, args: { object: string; container?: DocsContainer; payload: Record<string, unknown> }, actor: DocsActor): Promise<Result> {
    const { doc, door } = await this.#open(dir);
    checkContainer(doc, args.container);
    if (args.object !== 'utterance') refuse('invalid_argument', 'query 只列评论：object = "utterance"');
    const verdict = door.handle({ verb: 'query', object: 'utterance', payload: args.payload ?? {} }, agentContext(actor));
    if (verdict.verdict === 'deny') refuseVerdict(verdict);
    return shape(verdict);
  }

  async delete(dir: string, args: { ref: DocsRef; container?: DocsContainer }, actor: DocsActor): Promise<Result> {
    const { doc, door } = await this.#open(dir);
    checkContainer(doc, args.container);
    if (args.ref?.object === 'node') refuse('invalid_argument', '正文跟着标签页走：删标签页（file），或用 docs_update 清空它的内容');
    if (args.ref?.object === 'project') refuse('invalid_argument', '不能用工具删整份文档：告诉用户在 Space 里删');
    this.#call(door, { verb: 'delete', ref: args.ref }, agentContext(actor));
    await doc.flush();
    return { deleted: true, ref: args.ref };
  }

  async upload(dir: string, file: { bytes: Uint8Array; contentType: string; name: string }, actor: DocsActor) {
    const { doc, door } = await this.#open(dir);
    const mime = (file.contentType.split(';')[0] ?? '').trim().toLowerCase() || 'application/octet-stream';
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');
    await doc.putAsset(sha256, mime, file.bytes);
    const verdict = this.#call(door, { verb: 'create', object: 'blob', engine: 'blob', payload: { sha256, bytes: file.bytes.byteLength, mime, name: file.name } }, agentContext(actor));
    await doc.flush();
    const id = verdict.minted!;
    return { blob: `blob/${id}`, id, bytes: file.bytes.byteLength, contentType: mime, name: file.name };
  }

  async exportMarkdown(dir: string, args: { tab?: string }) {
    const { doc } = await this.#open(dir);
    const meta = doc.meta;
    let tabs: DocTab[];
    if (args.tab !== undefined) {
      const tab = meta.tabs.find((candidate) => candidate.id === args.tab || candidate.nodeId === args.tab);
      if (!tab) refuse('absent', `没有标签页 ${args.tab}：用 docs_read 的 files[].id`, { object: 'file', id: args.tab });
      tabs = [tab];
    } else tabs = visibleTabs(meta).sort(tabOrder);
    const options = { dropdownLabel: (enumId: string, index: number | undefined) => dropdownLabel(meta, enumId, index) };
    const parts = tabs.map((tab) => {
      const node = tab.nodeId ? doc.node(tab.nodeId) : undefined;
      const markdown = node ? blocksToMarkdown(node.blocks, options) : '';
      return tabs.length > 1 && !markdown.startsWith('# ') ? `# ${tab.name}\n\n${markdown}` : markdown;
    });
    return { markdown: parts.filter(Boolean).join('\n'), tabs: tabs.map((tab) => ({ id: tab.id, name: tab.name })) };
  }
}

// i18n-ignore-end

export function createDocsConnector(host: DocsConnectorHost): DocsConnector {
  return new Connector(host);
}
