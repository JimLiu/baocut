// i18n-ignore-file: 拒绝与错误的说明给智能体与运行日志看（编辑器按 code 显示自己的文字）
/**
 * door：编辑器与智能体读写一份文档的统一入口（与 Claude Docs 同一套 verb：read / update / create / delete / query）。
 * 对象：project（文档本身）、file（标签页）、node（正文）、utterance（评论）、session（编辑会话）、enum（下拉选项）、blob（素材）。
 *
 * - 写入要 `canEdit`（Web 服务的只读会话没有）；被拒时什么也没改。
 * - batch：成员按顺序执行，`$lid` 别名换成前面成员新建出的 id；任一成员被拒，整批不生效并报出它的下标。
 * - 改动后经 LiveDoc 的事件推给开着的编辑器（mux）。
 * - 带 `opId` 的写入只生效一次：编辑器把发出去还没等到回执的改动记在本地（`bongo.op-wal`、`bongo.comment-outbox`），
 *   页面关掉再打开时用同一个 opId 原样重发；已经生效过的回上次的回执，不再写、不再通知。
 */
import { randomUUID } from 'node:crypto';
import { applyJsonPatch, JsonPatchError, type JsonPatchOp } from './json-patch.ts';
import { AGENT_VIA, allow, deny, type DoorActor, type DoorAllow, type DoorBatchVerdict, type DoorRequest, type DoorVerdict, type WireComment } from './door-types.ts';
import type { DocEventActor, LiveDoc } from './live-doc.ts';
import { applyProseOps, type ApplyOptions, type OpResult, type ProseOp, type WireNode } from './prose-ops.ts';
import { compressBlock, documentOrder, findItem, isTextBlock, walkBlocks, type CharItem, type ProseBlock } from './prose-document.ts';
import { serializeDocument } from './prose-xml.ts';
import { isNodeId, shortId, visibleTabs, type CommentAuthor, type DocMeta, type DocTab, type LiveNode, type StoredReply, type StoredThread } from './store.ts';

/**
 * 服务端能力：编辑器据此决定发什么样的 op。
 * oneOrder = 所有编辑按同一顺序落地（没有它编辑器会停在只读，提示「等待服务器更新」）。
 */
export const SERVER_CAPS = { oneOrder: true };

/** 本机用户在文档里的身份（principal 是邮箱形式，编辑器显示 @ 前面的部分或显示名）。 */
export const LOCAL_PRINCIPAL = 'me@baocut.local';

/** 标签页文件的类型（Claude Docs 的正文页）。 */
export const PAGE_MIME = 'application/vnd.claude.page';

/** 评论的上限（与 Claude Docs 相同）。 */
export const COMMENT_LIMITS = { threads: 1000, perThread: 100, bodyBytes: 4096 };

/** 每份文档记住最近多少个生效过的 opId（只在 Runtime 进程里记）。 */
export const RECENT_OPS = 256;

/** 一次调用的身份与权限。 */
export interface DoorContext {
  actor: DoorActor;
  canEdit: boolean;
  /** 发起的 mux 连接：正文变化的通知不回发给它。 */
  origin?: unknown;
  /** 智能体回答的评论线程（`answering`）。 */
  answering?: string;
}

/** 本机用户（编辑器页面的人）。 */
export interface DoorUser {
  principal: string;
  name: string;
}

export function humanActor(user: DoorUser): DoorActor {
  return { principal: user.principal, name: user.name, channel: 'human' };
}

/** 项目读的 value：标签页表（只有显示在标签栏里的）+ 名称 + 版式。 */
export function projectValue(meta: DocMeta) {
  return {
    id: meta.id,
    name: meta.name,
    tabs: Object.fromEntries(
      visibleTabs(meta).map((tab) => [tab.id, { name: tab.name, ...(tab.order ? { order: tab.order } : {}), ...(tab.subtabOf ? { subtabOf: tab.subtabOf } : {}) }]),
    ),
    ...(meta.display ? { display: meta.display } : {}),
  };
}

type ProjectValue = ReturnType<typeof projectValue>;

/** 标签页（file）读的 value：`.ldoc` + node 内容会打开正文编辑器。 */
export function fileValue(tab: DocTab) {
  return {
    id: tab.id,
    name: tab.name,
    mime: PAGE_MIME,
    birthName: tab.birthName ?? `${tab.name}.ldoc`,
    ...(tab.nodeId ? { content: { kind: 'node', id: tab.nodeId, engine: 'prose', localId: 'ln-body' } } : {}),
  };
}

export function blobValue(blob: DocMeta['blobs'][string]) {
  return { engine: 'blob', sha256: blob.sha256, bytes: blob.bytes, mime: blob.mime, ...(blob.name ? { name: blob.name } : {}), ...(blob.parent ? { parent: blob.parent } : {}) };
}

/** 一次正文改动的结果（给连接器拼回执）。 */
export interface NodeUpdate {
  node: LiveNode;
  before: ProseBlock[];
  results: OpResult[];
  session: string;
}

const LID = /\$lid:([A-Za-z0-9_-]{1,64})/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把成员里的 `$lid:<别名>` 换成别名对应的 id；有不认识的别名时抛出 `UnknownLid`。 */
export function substituteLids<T>(value: T, lids: Record<string, string>): T {
  if (typeof value === 'string')
    return value.replace(LID, (whole, name: string) => {
      const id = lids[name];
      if (id === undefined) throw new UnknownLid(name);
      return id;
    }) as T;
  if (Array.isArray(value)) return value.map((item) => substituteLids(item, lids)) as T;
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteLids(item, lids)])) as T;
  return value;
}

export class UnknownLid extends Error {
  readonly lid: string;

  constructor(lid: string) {
    super(`没有叫 ${lid} 的 $lid`);
    this.lid = lid;
  }
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** 写入的去重键（调用者与 opId）；读、没有 opId 的调用与只读会话没有。 */
function opKey(request: DoorRequest, ctx: DoorContext): string | undefined {
  if (!ctx.canEdit || typeof request.opId !== 'string' || !request.opId || request.verb === 'read' || request.verb === 'query') return undefined;
  return `${ctx.actor.principal}\u0000${request.opId}`;
}

export class DocDoor {
  readonly doc: LiveDoc;
  readonly #user: () => DoorUser;
  /** 最近一次正文改动（连接器读回执用）。 */
  lastNodeUpdate: NodeUpdate | undefined;
  /** 生效过的写入：调用者与 opId → 当时的回执，旧的在前。 */
  readonly #applied = new Map<string, DoorAllow>();

  constructor(doc: LiveDoc, user: () => DoorUser) {
    this.doc = doc;
    this.#user = user;
  }

  get user(): DoorUser {
    return this.#user();
  }

  #eventActor(ctx: DoorContext): DocEventActor {
    return { principal: ctx.actor.principal, channel: ctx.actor.channel };
  }

  /** 单个调用：写入的调用自成一个事务。 */
  handle(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const replayed = this.#replayed(request, ctx);
    if (replayed) return replayed;
    const result = this.doc.transaction(() => {
      const verdict = this.#dispatch(request, ctx);
      return Object.assign(verdict, verdict.verdict === 'deny' ? { commit: false } : {});
    });
    if (result.verdict === 'allow') this.#remember(request, ctx, result);
    return result;
  }

  /** 已经生效过的写入（同一调用者、同一 opId）：上次的回执。 */
  #replayed(request: DoorRequest, ctx: DoorContext): DoorAllow | undefined {
    const key = opKey(request, ctx);
    const ack = key === undefined ? undefined : this.#applied.get(key);
    return ack && structuredClone(ack);
  }

  #remember(request: DoorRequest, ctx: DoorContext, ack: DoorAllow): void {
    const key = opKey(request, ctx);
    if (key === undefined) return;
    this.#applied.delete(key);
    this.#applied.set(key, structuredClone(ack));
    for (const oldest of this.#applied.keys()) {
      if (this.#applied.size <= RECENT_OPS) break;
      this.#applied.delete(oldest);
    }
  }

  /**
   * batch：逐个执行，任一被拒即整批回滚，报出 index。`lids` 是调用前已有的别名（新建文档时的 `p`、`f`、`n`）。
   * `dispatch` 可以接管某些成员（连接器的正文写法）：返回 undefined 时照常执行。
   */
  handleBatch(
    members: DoorRequest[],
    ctx: DoorContext,
    initial: Record<string, string> = {},
    dispatch?: (member: DoorRequest, index: number) => DoorVerdict | undefined,
  ): DoorBatchVerdict {
    const lids: Record<string, string> = { ...initial };
    const result = this.doc.transaction((): DoorBatchVerdict & { commit?: boolean } => {
      const acks: DoorAllow[] = [];
      for (const [index, raw] of members.entries()) {
        let member: DoorRequest;
        try {
          member = substituteLids(raw, lids);
        } catch (error) {
          if (error instanceof UnknownLid) return { ...deny('absent', error.message, { lid: error.lid }), index, commit: false };
          throw error;
        }
        const verdict = this.#replayed(member, ctx) ?? dispatch?.(member, index) ?? this.#dispatch(member, ctx);
        if (verdict.verdict === 'deny') return { ...verdict, index, commit: false };
        if (typeof raw.$lid === 'string' && raw.$lid) {
          const minted = verdict.minted ?? verdict.id;
          if (minted) lids[raw.$lid] = minted;
        }
        acks.push(verdict);
      }
      return { verdict: 'allow', acks, lids };
    });
    delete (result as { commit?: boolean }).commit;
    if (result.verdict === 'allow') for (const [index, member] of members.entries()) this.#remember(member, ctx, result.acks[index]!);
    return result;
  }

  #dispatch(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const object = request.ref?.object ?? request.object;
    const write = request.verb !== 'read' && request.verb !== 'query';
    if (write && !ctx.canEdit) return deny('forbidden', '只读：这个会话不能改文档');
    switch (`${request.verb}:${object}`) {
      case 'read:project':
        return this.#readProject(request);
      case 'update:project':
        return this.#updateProject(request, ctx);
      case 'read:file':
        return this.#readFile(request);
      case 'create:file':
        return this.#createFile(request, ctx);
      case 'update:file':
        return this.#updateFile(request, ctx);
      case 'delete:file':
        return this.#deleteFile(request, ctx);
      case 'read:node':
        return this.#readNode(request);
      case 'create:node':
        return this.#createNode(request, ctx);
      case 'update:node':
        return this.#updateNode(request, ctx);
      case 'create:session':
        return this.#createSession();
      case 'create:utterance':
        return this.#createUtterance(request, ctx);
      case 'update:utterance':
        return this.#updateUtterance(request, ctx);
      case 'delete:utterance':
        return this.#deleteUtterance(request, ctx);
      case 'read:utterance':
        return this.#readUtterance(request);
      case 'query:utterance':
        return this.#queryUtterances(request);
      case 'create:enum':
        return this.#createEnum(request, ctx);
      case 'read:enum':
        return this.#readEnum(request);
      case 'update:enum':
        return this.#updateEnum(request, ctx);
      case 'delete:enum':
        return this.#deleteEnum(request, ctx);
      case 'create:blob':
        return this.#createBlob(request, ctx);
      case 'read:blob':
        return this.#readBlob(request);
      case 'delete:blob':
        return this.#deleteBlob(request, ctx);
      default:
        if (request.engine && !['json', 'prose', 'blob'].includes(request.engine))
          return deny('unsupported', `${request.engine} 不支持：BaoCut 的文档没有图表、示意图与 widget，用表格或列表`);
        return deny('unsupported', `不支持 ${request.verb} ${object ?? ''}`);
    }
  }

  // ---------- project ----------

  #readProject(request: DoorRequest): DoorVerdict {
    const meta = this.doc.meta;
    const id = request.ref?.id;
    if (id && id !== meta.id) return deny('absent', `${id} 不是这份文档`, { object: 'project' });
    return allow({ rev: meta.rev, value: projectValue(meta) });
  }

  /** 改项目值：JSON patch 改名称、版式、标签页的名字 / 顺序 / 层级；`tabs` 里加上一个建好的标签页 = 放进标签栏，去掉 = 收起。 */
  #updateProject(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const meta = this.doc.meta;
    if (request.ref?.id && request.ref.id !== meta.id) return deny('absent', `${request.ref.id} 不是这份文档`, { object: 'project' });
    const patch = request.payload?.['patch'] as JsonPatchOp[] | undefined;
    if (request.payload?.['kind'] !== 'patch' || !Array.isArray(patch)) return deny('invalid_argument', '改文档要用 {"kind":"patch","patch":[…]}');
    let next: ProjectValue;
    try {
      next = applyJsonPatch(projectValue(meta), patch);
    } catch (error) {
      if (error instanceof JsonPatchError) return deny('invalid_argument', error.message);
      throw error;
    }
    if (next.id !== meta.id || typeof next.name !== 'string') return deny('invalid_argument', '文档 id 不能改，名称要是字符串');
    if (!isRecord(next.tabs)) return deny('invalid_argument', 'tabs 要是对象');
    if (next.display !== undefined && !isRecord(next.display)) return deny('invalid_argument', 'display 要是对象');
    const entries = Object.entries(next.tabs as Record<string, unknown>);
    for (const [id, value] of entries) {
      if (!meta.tabs.some((tab) => tab.id === id)) return deny('absent', `没有标签页 ${id}：先 create file`, { object: 'file', id });
      if (!isRecord(value)) return deny('invalid_argument', `tabs.${id} 要是对象`);
      if (value['name'] !== undefined && (typeof value['name'] !== 'string' || !value['name'].trim() || value['name'].length > 255))
        return deny('invalid_argument', `tabs.${id}.name 要是 1–255 个字符`);
      if (value['order'] !== undefined && (typeof value['order'] !== 'string' || value['order'].length > 64)) return deny('invalid_argument', `tabs.${id}.order 要是字符串`);
      const parent = value['subtabOf'];
      if (parent !== undefined && (typeof parent !== 'string' || parent === id || !(next.tabs as Record<string, unknown>)[parent]))
        return deny('invalid_argument', `tabs.${id}.subtabOf 要是另一个在标签栏里的标签页`);
    }
    // 层级不能成环
    const parentOf = new Map(entries.map(([id, value]) => [id, (value as { subtabOf?: string }).subtabOf]));
    for (const [id] of entries) {
      const seen = new Set([id]);
      for (let parent = parentOf.get(id); parent; parent = parentOf.get(parent)) {
        if (seen.has(parent)) return deny('invalid_argument', `标签页 ${id} 的 subtabOf 成环了`);
        seen.add(parent);
      }
    }
    if (entries.length === 0) return deny('last_tab', '文档至少要有一个标签页');

    meta.name = next.name.trim() || meta.name;
    for (const tab of meta.tabs) {
      const value = (next.tabs as Record<string, { name?: string; order?: string; subtabOf?: string }>)[tab.id];
      if (!value) {
        tab.hidden = true;
        continue;
      }
      delete tab.hidden;
      if (typeof value.name === 'string') tab.name = value.name.trim();
      if (typeof value.order === 'string') tab.order = value.order;
      else delete tab.order;
      if (typeof value.subtabOf === 'string') tab.subtabOf = value.subtabOf;
      else delete tab.subtabOf;
    }
    if (next.display && Object.keys(next.display).length) meta.display = next.display as Record<string, unknown>;
    else delete meta.display;
    this.doc.markMeta(true);
    this.doc.emit({ type: 'project', actor: this.#eventActor(ctx) });
    return allow({ rev: meta.rev, value: projectValue(meta), changed: true });
  }

  // ---------- file（标签页） ----------

  #tab(id: string | undefined): DocTab | undefined {
    return id ? this.doc.meta.tabs.find((tab) => tab.id === id || tab.nodeId === id) : undefined;
  }

  #readFile(request: DoorRequest): DoorVerdict {
    const tab = this.#tab(request.ref?.id);
    if (!tab) return deny('absent', `没有标签页 ${request.ref?.id ?? ''}`, { object: 'file' });
    return allow({ rev: this.doc.meta.rev, value: fileValue(tab) });
  }

  /** 新建标签页：先不放进标签栏（之后的 project patch 放它）。 */
  #createFile(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const value = (request.payload?.['value'] ?? {}) as { birthName?: unknown; name?: unknown; content?: unknown };
    const birthName = typeof value.birthName === 'string' ? value.birthName : typeof value.name === 'string' ? value.name : 'Untitled.ldoc';
    if (!birthName.trim() || birthName !== birthName.trim() || birthName.length > 255 || /[/\u0000-\u001f]/.test(birthName))
      return deny('invalid_argument', 'birthName 是文件名：不含 / 与控制字符，首尾没有空格，≤ 255');
    if (this.doc.meta.tabs.length >= 200) return deny('too_many', '一份文档最多 200 个标签页', { dim: 'tabs' });
    const tab: DocTab = { id: shortId(), name: birthName.replace(/\.ldoc$/i, '') || 'Untitled', birthName, hidden: true };
    const content = value.content as { kind?: string; id?: string } | undefined;
    if (content?.kind === 'node' && content.id) {
      const bound = this.#bindNode(tab, content.id);
      if (bound) return bound;
    }
    this.doc.meta.tabs.push(tab);
    this.doc.markMeta(true);
    this.doc.emit({ type: 'project', actor: this.#eventActor(ctx) });
    return allow({ minted: tab.id, id: tab.id, rev: this.doc.meta.rev, value: fileValue(tab) });
  }

  #bindNode(tab: DocTab, nodeId: string): DoorVerdict | undefined {
    if (!this.doc.node(nodeId)) return deny('absent', `没有正文 ${nodeId}`, { object: 'node', id: nodeId });
    const other = this.doc.meta.tabs.find((candidate) => candidate !== tab && candidate.nodeId === nodeId);
    if (other) return deny('invalid_argument', `正文 ${nodeId} 已经是标签页 ${other.id} 的`);
    tab.nodeId = nodeId;
    return undefined;
  }

  #updateFile(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const tab = this.#tab(request.ref?.id);
    if (!tab || tab.id !== request.ref?.id) return deny('absent', `没有标签页 ${request.ref?.id ?? ''}`, { object: 'file' });
    const payload = request.payload ?? {};
    let value: Record<string, unknown>;
    if (payload['kind'] === 'patch' && Array.isArray(payload['patch'])) {
      try {
        value = applyJsonPatch(fileValue(tab) as Record<string, unknown>, payload['patch'] as JsonPatchOp[]);
      } catch (error) {
        if (error instanceof JsonPatchError) return deny('invalid_argument', error.message);
        throw error;
      }
    } else if (isRecord(payload['value'])) value = payload['value'];
    else return deny('invalid_argument', '改标签页要用 {"kind":"value","value":{…}} 或 patch');
    if (typeof value['birthName'] === 'string') {
      const birthName = value['birthName'];
      if (!birthName.trim() || birthName !== birthName.trim() || birthName.length > 255 || /[/\u0000-\u001f]/.test(birthName))
        return deny('invalid_argument', 'birthName 是文件名：不含 / 与控制字符，首尾没有空格，≤ 255');
      tab.birthName = birthName;
    }
    const content = value['content'] as { kind?: string; id?: string } | undefined;
    if (content?.kind === 'node' && content.id && content.id !== tab.nodeId) {
      const bound = this.#bindNode(tab, content.id);
      if (bound) return bound;
    }
    this.doc.markMeta(true);
    this.doc.emit({ type: 'project', actor: this.#eventActor(ctx) });
    return allow({ rev: this.doc.meta.rev, value: fileValue(tab), changed: true });
  }

  /** 删标签页：连同它的正文与评论。文档至少留一个显示着的标签页。 */
  #deleteFile(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const meta = this.doc.meta;
    const tab = this.#tab(request.ref?.id);
    if (!tab || tab.id !== request.ref?.id) return deny('absent', `没有标签页 ${request.ref?.id ?? ''}`, { object: 'file' });
    if (!tab.hidden && visibleTabs(meta).length <= 1) return deny('last_tab', '文档至少要有一个标签页：要重来就替换它的内容');
    meta.tabs = meta.tabs.filter((candidate) => candidate !== tab);
    for (const other of meta.tabs) if (other.subtabOf === tab.id) delete other.subtabOf;
    if (tab.nodeId && !meta.tabs.some((other) => other.nodeId === tab.nodeId)) {
      this.doc.removeNode(tab.nodeId);
      const before = this.doc.threads.length;
      const kept = this.doc.threads.filter((thread) => thread.nodeId !== tab.nodeId);
      if (kept.length !== before) {
        this.doc.threads.splice(0, this.doc.threads.length, ...kept);
        this.doc.markComments();
      }
    }
    this.doc.markMeta(true);
    this.doc.emit({ type: 'project', actor: this.#eventActor(ctx) });
    return allow({ rev: meta.rev, changed: true });
  }

  // ---------- node（正文） ----------

  #readNode(request: DoorRequest): DoorVerdict {
    const node = this.doc.node(request.ref?.id ?? '');
    if (!node) return deny('absent', `没有正文 ${request.ref?.id ?? ''}`, { object: 'node' });
    const comments = this.wireComments(node.id);
    const anchors = comments.flatMap((comment) =>
      comment.at && !comment.resolved && comment.at.state === 'attached' ? [{ thread: comment.id, from: comment.at.range[0], to: comment.at.range[1] }] : [],
    );
    const doc = serializeDocument(node.blocks, { rev: node.rev, anchors });
    return allow({ rev: node.rev, data: { rev: node.rev, doc, comments } });
  }

  /** 正文 op 的选项：补发 id 的会话、blob 查询、本机用户；智能体的写法另带 `agent`。 */
  nodeOptions(node: LiveNode, ctx: DoorContext): ApplyOptions {
    const mint = this.doc.mintSession();
    return {
      rev: node.rev + 1,
      mintSession: mint.prefix,
      mintFrom: mint.next,
      blobExists: (ref) => !!this.doc.meta.blobs[ref.startsWith('blob/') ? ref.slice(5) : ref],
      blobInfo: (ref) => {
        const blob = this.doc.meta.blobs[ref.startsWith('blob/') ? ref.slice(5) : ref];
        return blob ? { mime: blob.mime, ...(blob.name ? { name: blob.name } : {}) } : undefined;
      },
      me: { principal: this.user.principal, name: this.user.name },
      ...(ctx.actor.channel === 'agent' ? { agent: true } : {}),
    };
  }

  /** 应用正文的 op。成功时记下 `lastNodeUpdate`。 */
  applyNodeOps(node: LiveNode, ops: ProseOp[], ctx: DoorContext, opId?: string): DoorVerdict {
    const options = this.nodeOptions(node, ctx);
    const outcome = applyProseOps(node.blocks, ops, options);
    if (!outcome.ok) return deny(outcome.reason, outcome.detail, { ...(outcome.data ?? {}), ...(outcome.index !== undefined ? { index: outcome.index } : {}) });
    return this.commitNodeBlocks(node, outcome.blocks, outcome.usedIds, outcome.results, options.mintSession, ctx, opId);
  }

  /** 把算好的正文落下（新的 rev）：记下用掉的 id 与提到的人、留快照、收拢评论锚点、通知开着的编辑器。 */
  commitNodeBlocks(node: LiveNode, blocks: ProseBlock[], usedIds: readonly string[], results: OpResult[], session: string, ctx: DoorContext, opId?: string): DoorAllow {
    const before = node.blocks;
    this.doc.advanceSessions(usedIds);
    this.#rememberPeople(blocks);
    this.doc.commitNode(node, blocks, node.rev + 1);
    this.#reanchor(node, before);
    this.lastNodeUpdate = { node, before, results, session };
    this.doc.emit({ type: 'node', nodeId: node.id, rev: node.rev, ...(opId ? { opId } : {}), origin: ctx.origin, actor: this.#eventActor(ctx) });
    return allow({ rev: node.rev, changed: true, data: { results } });
  }

  #updateNode(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const node = this.doc.node(request.ref?.id ?? '');
    if (!node) return deny('absent', `没有正文 ${request.ref?.id ?? ''}`, { object: 'node' });
    const ops = request.payload?.['ops'];
    if (!Array.isArray(ops)) return deny('invalid_argument', '改正文要 payload.ops');
    return this.applyNodeOps(node, ops as ProseOp[], ctx, request.opId);
  }

  /** 新建正文：`parent` 是它要属于的标签页；`source` 是初始内容（markdown / 块），没有时是一个空段落。 */
  #createNode(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    if (request.engine && request.engine !== 'prose') return deny('unsupported', `${request.engine} 不支持：BaoCut 的文档没有图表、示意图与 widget，用表格或列表`);
    const payload = request.payload ?? {};
    const parent = payload['parent'] as { object?: string; id?: string } | undefined;
    if (parent && (parent.object !== 'file' || !this.#tab(parent.id))) return deny('absent', `parent 要是这份文档里的标签页 {"object":"file","id":…}`, { object: 'file' });
    const mint = this.doc.mintSession();
    const paragraphId = `${mint.prefix}.${mint.next}`;
    this.doc.advanceSessions([paragraphId]);
    let id = shortId();
    while (!isNodeId(id) || this.doc.node(id)) id = shortId();
    const node: LiveNode = { id, rev: 1, blocks: [{ type: 'paragraph', id: paragraphId, rev: 1, items: [] }], history: [] };
    node.history.push({ rev: 1, blocks: node.blocks.map(compressBlock) });
    this.doc.addNode(node);
    const source = payload['source'] ?? (isRecord(payload['value']) ? (payload['value'] as Record<string, unknown>)['source'] : undefined);
    if (source) {
      const verdict = this.applyNodeOps(node, [{ op: 'replace', target: { kind: 'blocks', ids: [paragraphId] }, with: source } as ProseOp], ctx);
      if (verdict.verdict === 'deny') return verdict;
    }
    return allow({ minted: id, id, rev: node.rev });
  }

  #createSession(): DoorVerdict {
    const session = this.doc.openSession();
    return allow({ sess: session.prefix, sessSecret: session.secret, data: { next: session.next, caps: SERVER_CAPS, flags: {} } });
  }

  /** 记下正文里提到的人（@提及 的候选、名片的名字）。 */
  #rememberPeople(blocks: ProseBlock[]): void {
    const people = this.doc.meta.people;
    for (const { block } of walkBlocks(blocks)) {
      if (!isTextBlock(block)) continue;
      for (const item of block.items)
        if (item.kind === 'mention' && item.user && item.user !== 'claude' && !people[item.user] && (item.name || item.label))
          people[item.user] = { principal: item.user, name: item.name ?? item.label ?? item.user };
    }
  }

  /** 正文改了之后：锚点首尾的字被删掉但中间还有字留着的评论，收拢到还在的字上。 */
  #reanchor(node: LiveNode, before: ProseBlock[]): void {
    let changed = false;
    for (const thread of this.doc.threads) {
      if (thread.nodeId !== node.id || !thread.anchor) continue;
      if (findItem(node.blocks, thread.anchor.from) && findItem(node.blocks, thread.anchor.to)) continue;
      const covered = anchoredIds(before, thread.anchor.from, thread.anchor.to);
      const surviving = covered.filter((id) => findItem(node.blocks, id));
      if (!surviving.length) continue;
      thread.anchor = { ...thread.anchor, from: surviving[0]!, to: surviving[surviving.length - 1]! };
      changed = true;
    }
    if (changed) this.doc.markComments();
  }

  // ---------- utterance（评论） ----------

  /** 锚点覆盖的原文（评论卡片上的引用）。 */
  #quote(thread: StoredThread): string | undefined {
    const node = this.doc.node(thread.nodeId);
    if (!node || !thread.anchor) return undefined;
    const ids = new Set(anchoredIds(node.blocks, thread.anchor.from, thread.anchor.to));
    if (!ids.size) return thread.anchor.quote;
    let quote = '';
    for (const { block } of walkBlocks(node.blocks)) {
      if (!isTextBlock(block)) continue;
      for (const item of block.items) if (ids.has(item.id) && item.kind === 'char') quote += (item as CharItem).char;
    }
    return quote;
  }

  #attached(thread: StoredThread): boolean {
    const node = this.doc.node(thread.nodeId);
    return !!thread.anchor && !!node && !!findItem(node.blocks, thread.anchor.from) && !!findItem(node.blocks, thread.anchor.to);
  }

  toWireComment(thread: StoredThread): WireComment {
    const wire: WireComment = {
      id: thread.id,
      resolved: thread.resolved,
      by: thread.author.principal,
      byName: thread.author.name,
      via: thread.author.channel === 'agent' ? AGENT_VIA : null,
      created: thread.created,
      body: thread.body,
      replies: thread.replies
        .filter((reply) => !reply.kind)
        .map((reply) => ({
          id: reply.id,
          by: reply.author.principal,
          byName: reply.author.name,
          ...(reply.author.channel === 'agent' ? { via: AGENT_VIA } : {}),
          created: reply.created,
          body: reply.body,
          ...(reply.edited ? { edited: reply.edited } : {}),
        })),
      reactions: thread.reactions,
    };
    if (thread.edited) wire.edited = thread.edited;
    if (thread.anchor) {
      const quote = this.#quote(thread);
      wire.at = { kind: 'chars', range: [thread.anchor.from, thread.anchor.to], state: this.#attached(thread) ? 'attached' : 'detached', ...(quote ? { quote } : {}) };
    }
    return wire;
  }

  wireComments(nodeId: string): WireComment[] {
    return this.doc.threads
      .filter((thread) => thread.nodeId === nodeId)
      .sort((a, b) => a.created.localeCompare(b.created))
      .map((thread) => this.toWireComment(thread));
  }

  /** 按任一评论或回复的 id 找到所在的线程。 */
  threadOf(id: string): StoredThread | undefined {
    return this.doc.threads.find((thread) => thread.id === id || thread.replies.some((reply) => reply.id === id));
  }

  #author(ctx: DoorContext): CommentAuthor {
    return { principal: ctx.actor.principal, name: ctx.actor.name, channel: ctx.actor.channel };
  }

  #commentChanged(thread: StoredThread, ctx: DoorContext): void {
    this.doc.markComments();
    this.doc.emit({ type: 'comment', nodeId: thread.nodeId, threadId: thread.id, actor: this.#eventActor(ctx) });
  }

  /** create utterance：新评论、回复、resolve / reopen、表情都走这里，用 value.kind 区分。 */
  #createUtterance(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const value = (request.payload?.['value'] ?? {}) as {
      kind?: string;
      body?: unknown;
      emoji?: unknown;
      to?: unknown;
      parent?: { object?: string; id?: string; anchor?: { kind?: string; range?: [string, string] } };
    };
    const parent = value.parent ?? {};
    const author = this.#author(ctx);
    const now = new Date().toISOString();
    const kind = value.kind ?? 'message';
    const body = typeof value.body === 'string' ? value.body : '';
    if (utf8Bytes(body) > COMMENT_LIMITS.bodyBytes) return deny('row_too_large', `评论正文最多 ${COMMENT_LIMITS.bodyBytes} 字节`, { dim: 'body' });

    if (parent.object === 'utterance' && parent.id) {
      const thread = this.threadOf(parent.id);
      if (!thread) return deny('absent', `没有评论 ${parent.id}`, { object: 'utterance' });
      const id = randomUUID();
      if (kind === 'resolve' || kind === 'reopen') {
        if (ctx.actor.channel === 'agent' && threadHasHuman(thread))
          return deny('not_yours', '这个线程里有人写过：由他们来 resolve，你可以在线程里提议');
        thread.resolved = kind === 'resolve';
        thread.replies.push({ id, kind, body: '', author, created: now, seq: this.doc.nextCommentSeq() });
      } else if (kind === 'reaction') {
        const emoji = typeof value.emoji === 'string' ? value.emoji : '👍';
        const index = thread.reactions.findIndex((reaction) => reaction.emoji === emoji && reaction.by === author.principal);
        if (index >= 0) thread.reactions.splice(index, 1);
        else thread.reactions.push({ emoji, by: author.principal });
      } else {
        if (!body.trim()) return deny('invalid_argument', '回复不能是空的');
        if (thread.replies.filter((reply) => !reply.kind).length + 1 >= COMMENT_LIMITS.perThread)
          return deny('too_many', `一个线程最多 ${COMMENT_LIMITS.perThread} 条评论`, { dim: 'comments' });
        const reply: StoredReply = { id, body, author, created: now, seq: this.doc.nextCommentSeq(), ...(ctx.answering ? { answering: ctx.answering } : {}) };
        thread.replies.push(reply);
        if (thread.resolved && ctx.actor.channel === 'human') thread.resolved = false;
      }
      this.#commentChanged(thread, ctx);
      return allow({ minted: id, id });
    }

    if (parent.object !== 'node' || !parent.id) return deny('invalid_argument', '评论挂在正文上：parent = {"object":"node","id":…}，回复 parent = {"object":"utterance","id":…}');
    const node = this.doc.node(parent.id);
    if (!node) return deny('absent', `没有正文 ${parent.id}`, { object: 'node' });
    if (!body.trim()) return deny('invalid_argument', '评论不能是空的');
    if (this.doc.threads.length >= COMMENT_LIMITS.threads) return deny('too_many', `一份文档最多 ${COMMENT_LIMITS.threads} 个线程`, { dim: 'threads' });
    const range = parent.anchor?.range;
    if (range && (!findItem(node.blocks, range[0]) || !findItem(node.blocks, range[1]))) return deny('char_gone', '评论锚定的文字已不存在');
    const to = Array.isArray(value.to) ? value.to.filter((item): item is string => typeof item === 'string') : /^@(?:claude|agent)\b/i.test(body.trim()) ? ['claude'] : undefined;
    const thread: StoredThread = {
      id: randomUUID(),
      nodeId: node.id,
      body,
      author,
      created: now,
      resolved: false,
      replies: [],
      reactions: [],
      seq: this.doc.nextCommentSeq(),
      ...(to?.length ? { to } : {}),
      ...(range ? { anchor: { from: range[0], to: range[1] } } : {}),
    };
    if (thread.anchor) {
      const quote = this.#quote(thread);
      if (quote) thread.anchor.quote = quote.slice(0, 500);
    }
    this.doc.threads.push(thread);
    this.#commentChanged(thread, ctx);
    return allow({ minted: thread.id, id: thread.id });
  }

  /** update utterance：改正文（patch set ["body"] 或 value.body）；智能体只能改自己写的。 */
  #updateUtterance(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const id = request.ref?.id ?? '';
    const thread = this.threadOf(id);
    if (!thread) return deny('absent', `没有评论 ${id}`, { object: 'utterance' });
    const target = thread.id === id ? thread : thread.replies.find((reply) => reply.id === id)!;
    if (ctx.actor.channel === 'agent' && target.author.principal !== ctx.actor.principal) return deny('not_yours', '只能改你自己写的评论');
    let body: string | undefined;
    const patch = request.payload?.['patch'];
    if (Array.isArray(patch)) {
      for (const operation of patch as { op?: string; path?: unknown[]; value?: unknown }[])
        if (operation.op === 'set' && Array.isArray(operation.path) && operation.path[0] === 'body') body = String(operation.value ?? '');
    } else if (isRecord(request.payload?.['value']) && typeof (request.payload!['value'] as { body?: unknown }).body === 'string')
      body = (request.payload!['value'] as { body: string }).body;
    if (body === undefined) return deny('invalid_argument', '改评论要 patch [{"op":"set","path":["body"],"value":…}]');
    if (utf8Bytes(body) > COMMENT_LIMITS.bodyBytes) return deny('row_too_large', `评论正文最多 ${COMMENT_LIMITS.bodyBytes} 字节`, { dim: 'body' });
    Object.assign(target, { body, edited: new Date().toISOString() });
    this.#commentChanged(thread, ctx);
    return allow({ changed: true });
  }

  #deleteUtterance(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const id = request.ref?.id ?? '';
    const thread = this.threadOf(id);
    if (!thread) return ctx.actor.channel === 'agent' ? deny('absent', `没有评论 ${id}`, { object: 'utterance' }) : allow({ noop: true });
    const target = thread.id === id ? thread : thread.replies.find((reply) => reply.id === id)!;
    if (ctx.actor.channel === 'agent' && target.author.principal !== ctx.actor.principal) return deny('not_yours', '只能删你自己写的评论');
    if (thread.id === id) {
      if (ctx.actor.channel === 'agent' && thread.replies.some((reply) => reply.author.principal !== ctx.actor.principal))
        return deny('not_yours', '线程里有别人的回复：只能删你自己的回复');
      this.doc.threads.splice(this.doc.threads.indexOf(thread), 1);
    } else thread.replies = thread.replies.filter((reply) => reply.id !== id);
    this.#commentChanged(thread, ctx);
    return allow({ changed: true });
  }

  #readUtterance(request: DoorRequest): DoorVerdict {
    const thread = this.threadOf(request.ref?.id ?? '');
    if (!thread) return deny('absent', `没有评论 ${request.ref?.id ?? ''}`, { object: 'utterance' });
    return allow({ value: this.toWireComment(thread) });
  }

  /** 评论行（给智能体）：每条评论、回复、resolve 一行，按 seq 升序。 */
  utteranceRows(under: { object?: string; id?: string }, afterSeq = 0, limit = 200) {
    let threads = this.doc.threads;
    if (under.object === 'utterance') {
      const thread = under.id ? this.threadOf(under.id) : undefined;
      if (!thread) return undefined;
      threads = [thread];
    } else if (under.object === 'file') {
      const tab = this.#tab(under.id);
      if (!tab || tab.id !== under.id) return undefined;
      threads = threads.filter((thread) => thread.nodeId === tab.nodeId);
    } else if (under.object === 'node') {
      if (!under.id || !this.doc.node(under.id)) return undefined;
      threads = threads.filter((thread) => thread.nodeId === under.id);
    } else if (under.object !== undefined && under.object !== 'project') return undefined;
    const self = this.user.principal;
    const actorOf = (author: CommentAuthor) => ({ principal: author.principal, name: author.name, channel: author.channel, ...(author.principal === self ? { self: true } : {}) });
    const rows: Record<string, unknown>[] = [];
    for (const thread of threads) {
      const answered = thread.to?.includes('claude') ? thread.replies.some((reply) => !reply.kind && reply.author.channel === 'agent') : undefined;
      rows.push({
        id: thread.id,
        seq: thread.seq,
        verb: 'create',
        created: thread.created,
        ...(thread.edited ? { edited: thread.edited } : {}),
        actor: actorOf(thread.author),
        payload: {
          value: {
            body: thread.body,
            parent: {
              object: 'node',
              id: thread.nodeId,
              ...(thread.anchor ? { anchor: { kind: 'chars', range: [thread.anchor.from, thread.anchor.to], state: this.#attached(thread) ? 'attached' : 'detached', quote: this.#quote(thread) ?? thread.anchor.quote ?? '' } } : {}),
            },
          },
        },
        resolved: thread.resolved,
        ...(thread.to ? { to: thread.to.length === 1 ? thread.to[0] : thread.to, answered } : {}),
      });
      for (const reply of thread.replies)
        rows.push({
          id: reply.id,
          seq: reply.seq,
          verb: 'create',
          created: reply.created,
          ...(reply.edited ? { edited: reply.edited } : {}),
          actor: actorOf(reply.author),
          payload: { value: { ...(reply.kind ? { kind: reply.kind } : { body: reply.body }), parent: { object: 'utterance', id: thread.id } } },
        });
    }
    const sorted = rows.filter((row) => (row['seq'] as number) > afterSeq).sort((a, b) => (a['seq'] as number) - (b['seq'] as number));
    const page = sorted.slice(0, Math.max(1, Math.min(limit, 1000)));
    return { rows: page, seq: this.doc.commentSeq, more: sorted.length > page.length };
  }

  #queryUtterances(request: DoorRequest): DoorVerdict {
    const payload = request.payload ?? {};
    const under = (payload['under'] ?? {}) as { object?: string; id?: string };
    const afterSeq = typeof payload['afterSeq'] === 'number' ? payload['afterSeq'] : 0;
    const limit = typeof payload['limit'] === 'number' ? payload['limit'] : 200;
    const result = this.utteranceRows(under, afterSeq, limit);
    if (!result) return deny('absent', `under 要是这份文档里的正文、标签页或线程`, { object: under.object });
    return allow({ data: result });
  }

  // ---------- enum（下拉选项） ----------

  #enumValue(raw: unknown): Record<string, unknown> | string {
    if (!isRecord(raw)) return 'enum 的 value 要是 {"name","options":[{"name"},…]}';
    const name = raw['name'];
    const options = raw['options'];
    if (typeof name !== 'string' || !name.trim() || name.length > 100) return 'enum 要有 name（1–100 个字符）';
    if (!Array.isArray(options) || options.length === 0 || options.length > 100) return 'enum 要有 1–100 个 options';
    for (const option of options)
      if (!isRecord(option) || typeof option['name'] !== 'string' || !option['name'].trim() || option['name'].length > 100)
        return '每个选项是 {"name":"…"}（可带 color）';
    return { ...raw, name: name.trim(), options: options.map((option) => ({ ...(option as Record<string, unknown>) })) };
  }

  #createEnum(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const value = this.#enumValue(request.payload?.['value']);
    if (typeof value === 'string') return deny('invalid_argument', value);
    if (Object.keys(this.doc.meta.enums).length >= 200) return deny('too_many', '一份文档最多 200 个下拉选项', { dim: 'enums' });
    const id = shortId();
    this.doc.meta.enums[id] = value;
    this.doc.markMeta(true);
    this.doc.emit({ type: 'project', actor: this.#eventActor(ctx) });
    return allow({ minted: id, id, value });
  }

  #readEnum(request: DoorRequest): DoorVerdict {
    const value = this.doc.meta.enums[request.ref?.id ?? ''];
    if (!value) return deny('absent', `没有下拉选项 ${request.ref?.id ?? ''}`, { object: 'enum' });
    return allow({ rev: this.doc.meta.rev, value });
  }

  #updateEnum(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const id = request.ref?.id ?? '';
    const current = this.doc.meta.enums[id];
    if (!current) return deny('absent', `没有下拉选项 ${id}`, { object: 'enum' });
    let raw: unknown = request.payload?.['value'];
    if (request.payload?.['kind'] === 'patch' && Array.isArray(request.payload['patch'])) {
      try {
        raw = applyJsonPatch(current, request.payload['patch'] as JsonPatchOp[]);
      } catch (error) {
        if (error instanceof JsonPatchError) return deny('invalid_argument', error.message);
        throw error;
      }
    }
    const value = this.#enumValue(raw);
    if (typeof value === 'string') return deny('invalid_argument', value);
    this.doc.meta.enums[id] = value;
    this.doc.markMeta(true);
    this.doc.emit({ type: 'project', actor: this.#eventActor(ctx) });
    return allow({ rev: this.doc.meta.rev, value, changed: true });
  }

  #deleteEnum(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const id = request.ref?.id ?? '';
    if (!this.doc.meta.enums[id]) return deny('absent', `没有下拉选项 ${id}`, { object: 'enum' });
    delete this.doc.meta.enums[id];
    this.doc.markMeta(true);
    this.doc.emit({ type: 'project', actor: this.#eventActor(ctx) });
    return allow({ changed: true });
  }

  // ---------- blob（素材） ----------

  #createBlob(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const payload = request.payload ?? {};
    const sha256 = payload['sha256'];
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return deny('invalid_argument', 'blob 要 sha256（先 POST /api/blob 上传字节）');
    if (!this.doc.hasAsset(sha256)) return deny('absent', '这份文档里没有这些字节：先上传', { object: 'blob' });
    const mime = typeof payload['mime'] === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(payload['mime']) ? payload['mime'] : 'application/octet-stream';
    const parent = isRecord(payload['parent']) && typeof payload['parent']['object'] === 'string' && typeof payload['parent']['id'] === 'string'
      ? { object: payload['parent']['object'] as string, id: payload['parent']['id'] as string }
      : undefined;
    const id = sha256.slice(0, 12) + randomUUID().slice(0, 4);
    this.doc.meta.blobs[id] = {
      id,
      sha256,
      bytes: typeof payload['bytes'] === 'number' ? payload['bytes'] : 0,
      mime,
      ...(typeof payload['name'] === 'string' ? { name: payload['name'].slice(0, 255) } : {}),
      ...(parent ? { parent } : {}),
      created: new Date().toISOString(),
    };
    this.doc.markMeta(true);
    this.doc.emit({ type: 'project', actor: this.#eventActor(ctx) });
    return allow({ minted: id, id, value: blobValue(this.doc.meta.blobs[id]!) });
  }

  #readBlob(request: DoorRequest): DoorVerdict {
    const id = (request.ref?.id ?? '').replace(/^blob\//, '');
    const blob = this.doc.meta.blobs[id];
    if (!blob) return deny('absent', `没有素材 ${id}`, { object: 'blob' });
    return allow({ value: blobValue(blob) });
  }

  #deleteBlob(request: DoorRequest, ctx: DoorContext): DoorVerdict {
    const id = (request.ref?.id ?? '').replace(/^blob\//, '');
    if (!this.doc.meta.blobs[id]) return deny('absent', `没有素材 ${id}`, { object: 'blob' });
    delete this.doc.meta.blobs[id];
    this.doc.markMeta(true);
    this.doc.emit({ type: 'project', actor: this.#eventActor(ctx) });
    return allow({ changed: true });
  }
}

/** 锚点 [from, to] 覆盖的条目 id（按文档顺序）。 */
export function anchoredIds(blocks: ProseBlock[], from: string, to: string): string[] {
  const order = documentOrder(blocks);
  const start = order.get(from);
  const end = order.get(to);
  if (start === undefined || end === undefined) return [];
  const ids: string[] = [];
  for (const { block } of walkBlocks(blocks)) {
    if (!isTextBlock(block)) continue;
    for (const item of block.items) {
      const position = order.get(item.id)!;
      if (position >= start && position <= end) ids.push(item.id);
    }
  }
  return ids;
}

function threadHasHuman(thread: StoredThread): boolean {
  return thread.author.channel === 'human' || thread.replies.some((reply) => !reply.kind && reply.author.channel === 'human');
}

export type { WireNode };
