// i18n-ignore-file: 拒绝与错误的说明给智能体与运行日志看（编辑器按 code 显示自己的文字）
/**
 * 文档目录的磁盘格式（docs/design/docs §2）：
 *
 * ```
 * <doc>/
 *   doc.json              文档本身：id、名称、标签页表、版式、下拉选项（enum）、素材记录（blob）、编辑会话、提到过的人
 *   tabs/<正文 id>.json    一个标签页的正文 { id, rev, blocks }，块按「文本段」压缩存放
 *   tabs/<正文 id>.history.json  最近若干个 rev 的正文快照（找回删掉的字、`atRev` / `sinceRev` 读、`restore`）
 *   comments.json         评论线程、回复、resolve
 *   assets/<sha256>.<ext> 上传的图片与文件，按内容寻址
 * ```
 *
 * 认文档只看 `doc.json` 的 `format`。写入都是临时文件加改名。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { newSessionPrefix, type CharId } from './char-id.ts';
import { compressBlock, readBlocks, type ProseBlock, type StoredBlock } from './prose-document.ts';

export const DOC_FILE = 'doc.json';
export const DOC_FORMAT = 'baocut-doc';
export const TABS_DIR = 'tabs';
export const COMMENTS_FILE = 'comments.json';
export const ASSETS_DIR = 'assets';

/** 一个标签页：`nodeId` 是它的正文。`order` 与 `subtabOf` 决定标签栏里的位置。 */
export interface DocTab {
  id: string;
  /** 显示的名字。 */
  name: string;
  /** 文件名（`<名字>.ldoc`）：编辑器新建标签页时给的，显示名另在 `name`。 */
  birthName?: string;
  order?: string;
  subtabOf?: string;
  /** 正文 id；新建标签页、还没指向正文时没有。 */
  nodeId?: string;
  /** 不显示的标签页：建了但还没放进标签栏（`tabs` 表里没有它）。 */
  hidden?: boolean;
}

/** 素材记录：字节在 `assets/<sha256>.<ext>`。 */
export interface DocBlob {
  id: string;
  sha256: string;
  bytes: number;
  mime: string;
  name?: string;
  parent?: { object: string; id: string };
  created: string;
}

export interface DocSession {
  prefix: string;
  /** 下一个可分配的序号。 */
  next: number;
  secret: string;
}

/** 文档里出现过的人（提及、评论作者）：principal → 显示名。 */
export interface DocPerson {
  principal: string;
  name: string;
}

export interface DocMeta {
  format: typeof DOC_FORMAT;
  version: 1;
  id: string;
  name: string;
  created: string;
  updated: string;
  /** 文档级修订号：改名、增删标签页、改版式、改下拉选项时递增。 */
  rev: number;
  display?: Record<string, unknown>;
  tabs: DocTab[];
  /** 下拉选项（项目级 enum）：id → 值（`{name, options:[{name, color?}]}`）。 */
  enums: Record<string, Record<string, unknown>>;
  blobs: Record<string, DocBlob>;
  sessions: Record<string, DocSession>;
  /** 服务端补发 id 用的会话前缀。 */
  mintPrefix?: string;
  people: Record<string, DocPerson>;
}

export interface CommentAuthor {
  principal: string;
  name: string;
  channel: 'human' | 'agent';
}

/** 线程里的一条：回复，或 resolve / reopen 记录。 */
export interface StoredReply {
  id: string;
  kind?: 'resolve' | 'reopen';
  body: string;
  author: CommentAuthor;
  created: string;
  edited?: string;
  seq: number;
  /** 这条回复回答的是哪一回合的请求（智能体回复时记下，用来判断线程是否已答）。 */
  answering?: string;
}

export interface StoredThread {
  id: string;
  nodeId: string;
  body: string;
  author: CommentAuthor;
  created: string;
  edited?: string;
  resolved: boolean;
  anchor?: { from: CharId; to: CharId; quote?: string };
  /** 线程生来就是问智能体的（`@Agent …`、以前的 `@Claude …`，或「发送给智能体」）。 */
  to?: string[];
  replies: StoredReply[];
  reactions: { emoji: string; by: string }[];
  seq: number;
}

export interface CommentsFile {
  /** 评论行的最新序号：每条评论、回复、resolve 各占一个。 */
  seq: number;
  threads: StoredThread[];
}

export interface StoredNode {
  id: string;
  rev: number;
  blocks: StoredBlock[];
}

/** 一个 rev 时的正文快照。 */
export interface NodeSnapshot {
  rev: number;
  blocks: StoredBlock[];
}

/** 内存里的正文：块已展开成逐字条目。 */
export interface LiveNode {
  id: string;
  rev: number;
  blocks: ProseBlock[];
  /** 最近的快照，按 rev 升序；最后一个是当前 rev。 */
  history: NodeSnapshot[];
}

/** 一份文档读进内存的全部内容。 */
export interface DocState {
  meta: DocMeta;
  nodes: Map<string, LiveNode>;
  comments: CommentsFile;
}

/** 每个正文留多少个 rev 的快照。 */
export const HISTORY_LIMIT = 50;

export interface DocInfo {
  id: string;
  /** 标题：`doc.json` 的 `name` 去掉首尾空白，没有时用目录名。 */
  name: string;
  /** 标签页数（显示在标签栏里的）。 */
  tabs: number;
  /** 没 resolve 的线程数。 */
  openThreads: number;
}

export class DocFileError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 新的标签页 / 正文 id：与 Claude Docs 相同，UUID 的前 13 个字符（`afc001d0-ce07`）。 */
export function shortId(): string {
  return randomUUID().slice(0, 13);
}

/** 标题：去掉首尾空白，空的时候用目录名。 */
export function docTitle(name: unknown, dir: string): string {
  const title = typeof name === 'string' ? name.trim() : '';
  return title || path.basename(dir);
}

/** 显示在标签栏里的标签页。 */
export function visibleTabs(meta: Pick<DocMeta, 'tabs'>): DocTab[] {
  return meta.tabs.filter((tab) => !tab.hidden);
}

/** 读并校验 `doc.json`；不是文档（没有、是符号链接、读不了、格式不对）时 null。 */
async function readMeta(dir: string): Promise<DocMeta | null> {
  const file = path.join(dir, DOC_FILE);
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
  return isDocMeta(raw) ? normalizeMeta(raw) : null;
}

function isDocMeta(raw: unknown): raw is DocMeta {
  return (
    isRecord(raw) &&
    raw['format'] === DOC_FORMAT &&
    raw['version'] === 1 &&
    typeof raw['id'] === 'string' &&
    typeof raw['name'] === 'string' &&
    Array.isArray(raw['tabs']) &&
    raw['tabs'].every((tab) => isRecord(tab) && typeof tab['id'] === 'string' && typeof tab['name'] === 'string')
  );
}

function normalizeMeta(raw: DocMeta): DocMeta {
  const now = new Date().toISOString();
  return {
    ...raw,
    created: typeof raw.created === 'string' ? raw.created : now,
    updated: typeof raw.updated === 'string' ? raw.updated : now,
    rev: Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : 1,
    enums: isRecord(raw.enums) ? raw.enums : {},
    blobs: isRecord(raw.blobs) ? raw.blobs : {},
    sessions: isRecord(raw.sessions) ? raw.sessions : {},
    people: isRecord(raw.people) ? raw.people : {},
  };
}

async function readComments(dir: string): Promise<CommentsFile> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, COMMENTS_FILE), 'utf8')) as Partial<CommentsFile>;
    const threads = Array.isArray(raw.threads) ? raw.threads.filter((thread) => isRecord(thread) && typeof thread.id === 'string') : [];
    return {
      seq: Number.isInteger(raw.seq) ? raw.seq! : 0,
      threads: threads.map((thread) => ({ ...thread, replies: Array.isArray(thread.replies) ? thread.replies : [], reactions: Array.isArray(thread.reactions) ? thread.reactions : [] })),
    };
  } catch {
    return { seq: 0, threads: [] };
  }
}

/** 读一个目录的文档概况；不是文档时 null。不跟随 `doc.json` 的符号链接。 */
export async function readDocInfo(dir: string): Promise<DocInfo | null> {
  const meta = await readMeta(dir);
  if (!meta) return null;
  const comments = await readComments(dir);
  return {
    id: meta.id,
    name: docTitle(meta.name, dir),
    tabs: visibleTabs(meta).length,
    openThreads: comments.threads.filter((thread) => !thread.resolved).length,
  };
}

/** Space 扫描用的文档目录概况：大小与时间取目录与第一层子目录里的普通文件（同 deck、设计稿）。 */
export interface DocDirStat {
  title: string;
  tabCount: number;
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
}

/** 目录是文档时返回它的概况，否则 null。不跟随符号链接，跳过以点开头的文件与目录。 */
export async function inspectDoc(dir: string): Promise<DocDirStat | null> {
  const info = await readDocInfo(dir);
  if (!info) return null;
  const docFile = await fs.lstat(path.join(dir, DOC_FILE)).catch(() => null);
  if (!docFile) return null;
  let size = 0;
  let mtimeMs = docFile.mtimeMs;
  const add = async (folder: string, depth: number): Promise<void> => {
    const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (depth === 0) await add(full, 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.lstat(full).catch(() => null);
      if (!stat) continue;
      size += stat.size;
      mtimeMs = Math.max(mtimeMs, stat.mtimeMs);
    }
  };
  await add(dir, 0);
  return { title: info.name, tabCount: info.tabs, size, mtimeMs, birthtimeMs: docFile.birthtimeMs };
}

function tabFile(dir: string, nodeId: string): string {
  return path.join(dir, TABS_DIR, `${nodeId}.json`);
}

function historyFile(dir: string, nodeId: string): string {
  return path.join(dir, TABS_DIR, `${nodeId}.history.json`);
}

/** 正文 id 只用字母数字与 `-` `_`：它也是文件名。 */
export function isNodeId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

async function readNode(dir: string, nodeId: string): Promise<LiveNode> {
  const raw = JSON.parse(await fs.readFile(tabFile(dir, nodeId), 'utf8')) as Partial<StoredNode>;
  const rev = Number.isInteger(raw.rev) && raw.rev! >= 0 ? raw.rev! : 1;
  const blocks = readBlocks(raw.blocks, `${TABS_DIR}/${nodeId}.json`);
  let history: NodeSnapshot[] = [];
  try {
    const stored = JSON.parse(await fs.readFile(historyFile(dir, nodeId), 'utf8')) as { snapshots?: NodeSnapshot[] };
    history = (stored.snapshots ?? []).filter((snapshot) => Number.isInteger(snapshot.rev) && snapshot.rev < rev && Array.isArray(snapshot.blocks));
  } catch {
    // 没有快照文件：只有当前 rev
  }
  history.push({ rev, blocks: blocks.map(compressBlock) });
  return { id: nodeId, rev, blocks, history: history.slice(-HISTORY_LIMIT) };
}

/** 把整份文档读进内存；不是文档时 null，正文文件坏了时抛 DocFileError。 */
export async function loadDocState(dir: string): Promise<DocState | null> {
  const meta = await readMeta(dir);
  if (!meta) return null;
  const nodes = new Map<string, LiveNode>();
  for (const tab of meta.tabs) {
    if (!tab.nodeId || nodes.has(tab.nodeId)) continue;
    if (!isNodeId(tab.nodeId)) throw new DocFileError(`标签页 ${tab.id} 的正文 id 不合法`);
    try {
      nodes.set(tab.nodeId, await readNode(dir, tab.nodeId));
    } catch (error) {
      throw new DocFileError(`读不了标签页 ${tab.id} 的正文：${(error as Error).message}`);
    }
  }
  return { meta, nodes, comments: await readComments(dir) };
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temporary, content);
  await fs.rename(temporary, file);
}

/** 要写回磁盘的部分。 */
export interface DirtySet {
  meta: boolean;
  comments: boolean;
  nodes: Set<string>;
  /** 删掉的正文：连同快照文件一起删。 */
  removedNodes: Set<string>;
}

export function emptyDirty(): DirtySet {
  return { meta: false, comments: false, nodes: new Set(), removedNodes: new Set() };
}

/** 把改过的部分写回目录；`doc.json` 最后写（它在，文档才算存在）。 */
export async function writeDocState(dir: string, state: DocState, dirty: DirtySet): Promise<void> {
  for (const nodeId of dirty.nodes) {
    const node = state.nodes.get(nodeId);
    if (!node) continue;
    const stored: StoredNode = { id: node.id, rev: node.rev, blocks: node.blocks.map(compressBlock) };
    await writeAtomic(tabFile(dir, nodeId), `${JSON.stringify(stored)}\n`);
    const snapshots = node.history.filter((snapshot) => snapshot.rev < node.rev);
    if (snapshots.length) await writeAtomic(historyFile(dir, nodeId), `${JSON.stringify({ snapshots })}\n`);
  }
  for (const nodeId of dirty.removedNodes) {
    if (state.nodes.has(nodeId)) continue;
    await fs.rm(tabFile(dir, nodeId), { force: true });
    await fs.rm(historyFile(dir, nodeId), { force: true });
  }
  if (dirty.comments) await writeAtomic(path.join(dir, COMMENTS_FILE), `${JSON.stringify(state.comments, null, 1)}\n`);
  if (dirty.meta) await writeAtomic(path.join(dir, DOC_FILE), `${JSON.stringify(state.meta, null, 2)}\n`);
}

/** 一份新文档的内存状态：一个标签页，正文是一个空段落。 */
export function newDocState(name: string, ids: { docId?: string; tabId?: string; nodeId?: string } = {}): DocState {
  const now = new Date().toISOString();
  const session: DocSession = { prefix: newSessionPrefix(), next: 1, secret: newSessionPrefix() };
  const tab: DocTab = { id: ids.tabId ?? shortId(), name: name.trim() || 'Untitled', order: 'a0', nodeId: ids.nodeId ?? shortId() };
  const meta: DocMeta = {
    format: DOC_FORMAT,
    version: 1,
    id: ids.docId ?? randomUUID(),
    name: name.trim(),
    created: now,
    updated: now,
    rev: 1,
    tabs: [tab],
    enums: {},
    blobs: {},
    sessions: { [session.prefix]: session },
    mintPrefix: session.prefix,
    people: {},
  };
  const blocks: ProseBlock[] = [{ type: 'paragraph', id: `${session.prefix}.0`, rev: 1, items: [] }];
  const node: LiveNode = { id: tab.nodeId!, rev: 1, blocks, history: [{ rev: 1, blocks: blocks.map(compressBlock) }] };
  return { meta, nodes: new Map([[node.id, node]]), comments: { seq: 0, threads: [] } };
}

/**
 * 在 `dir`（不存在或是空目录）新建一份文档：一个标签页，正文是一个空段落。返回文档、标签页与正文的 id。
 * 给测试与导入用；智能体新建文档走连接器（`docs_batch` 的 `container.create`），正文直接由 markdown 写成。
 */
export async function createDoc(dir: string, options: { name: string }): Promise<{ id: string; tabId: string; nodeId: string }> {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir);
  if (entries.length > 0) throw new DocFileError(`${dir} 不是空目录`);
  const state = newDocState(options.name);
  const dirty = emptyDirty();
  dirty.meta = true;
  dirty.comments = true;
  for (const nodeId of state.nodes.keys()) dirty.nodes.add(nodeId);
  await writeDocState(dir, state, dirty);
  const tab = state.meta.tabs[0]!;
  return { id: state.meta.id, tabId: tab.id, nodeId: tab.nodeId! };
}
