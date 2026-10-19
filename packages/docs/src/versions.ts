/**
 * 正文的版本记录（版本记录设计 §13.2）：50 个 rev 的快照相当于撤销的深度，版本是「一段工作」。每次正文落下新的 rev 时，
 * 在写的那一刻判断它并进还开着的那一版，还是另开一版（§3.1）：
 *
 * - 安静满 5 分钟：还开着的那一版最后一次改动距现在超过 5 分钟；
 * - 满 30 分钟：一直在改时，30 分钟切一版；
 * - 智能体的新回合：智能体在这一版里第一次以这个回合（任务）写；
 * - 回到版本单独成一版，生来就收口，之后的改动另开一版。
 *
 * 关掉文档不收口：5 分钟内再打开接着改，改动并进同一版。每个正文最多留 `VERSIONS_LIMIT` 个，删最旧的。
 */
import { compressBlock, expandBlock, plainText, type ProseBlock } from './prose-document.ts';
import { VERSIONS_LIMIT, type LiveNode, type NodeVersion, type VersionAuthor, type VersionCut } from './store.ts';

/** 安静多久之后另开一版。 */
export const VERSION_QUIET_MS = 5 * 60_000;
/** 一版最长多久。 */
export const VERSION_MAX_MS = 30 * 60_000;

/** 正文落下一个新 rev 时记进版本：`before` / `beforeRev` 是这次改动之前的正文与 rev。 */
export function recordVersion(
  node: LiveNode,
  change: { before: ProseBlock[]; beforeRev: number; author?: VersionAuthor; restoredFrom?: number; now: number },
): void {
  const versions = node.versions;
  const at = new Date(change.now).toISOString();
  const last = versions[versions.length - 1];
  const open = last && !last.blocks ? last : undefined;
  const author = change.author;
  if (change.restoredFrom !== undefined) {
    if (open) seal(open, change.before, 'restore');
    else if (last && last.rev === change.beforeRev) last.cut ??= 'restore';
    push(node, { baseRev: change.beforeRev, rev: node.rev, start: at, end: at, by: author ? [author] : [], restoredFrom: change.restoredFrom, blocks: node.blocks.map(compressBlock) });
    return;
  }
  if (open) {
    const cut = cutBefore(open, author, change.now);
    if (!cut) {
      open.rev = node.rev;
      open.end = at;
      if (author) addAuthor(open, author);
      return;
    }
    seal(open, change.before, cut);
  }
  push(node, { baseRev: change.beforeRev, rev: node.rev, start: at, end: at, by: author ? [author] : [] });
}

/** 还开着的那一版是否在这次改动之前收口；不收口时 undefined。 */
function cutBefore(open: NodeVersion, author: VersionAuthor | undefined, now: number): VersionCut | undefined {
  if (now - Date.parse(open.end) >= VERSION_QUIET_MS) return 'quiet';
  if (now - Date.parse(open.start) >= VERSION_MAX_MS) return 'max';
  if (author?.channel === 'agent' && author.turn && !open.by.some((by) => sameAuthor(by, author) && by.turn === author.turn)) return 'turn';
  return undefined;
}

function seal(version: NodeVersion, blocks: ProseBlock[], cut: VersionCut): void {
  version.blocks = blocks.map(compressBlock);
  version.cut = cut;
}

function push(node: LiveNode, version: Omit<NodeVersion, 'n'>): void {
  const n = (node.versions[node.versions.length - 1]?.n ?? 0) + 1;
  node.versions.push({ n, ...version });
  if (node.versions.length > VERSIONS_LIMIT) node.versions.splice(0, node.versions.length - VERSIONS_LIMIT);
}

function sameAuthor(a: VersionAuthor, b: VersionAuthor): boolean {
  return a.principal === b.principal && a.channel === b.channel && a.conversation === b.conversation;
}

/** 记下改过这一版的人；智能体同一会话只记一次，回合换成最新的。 */
function addAuthor(version: NodeVersion, author: VersionAuthor): void {
  const known = version.by.find((by) => sameAuthor(by, author));
  if (!known) version.by.push(author);
  else {
    known.name = author.name;
    if (author.turn) known.turn = author.turn;
  }
}

/** 这一版结束时的正文（展开后）：收口的版本是存下的正文，还开着的是标签页现在的正文。 */
export function versionBlocks(node: LiveNode, version: NodeVersion): ProseBlock[] {
  if (!version.blocks) return node.blocks;
  return version.blocks.map((block, index) => expandBlock(block, `versions.${version.n}[${index}]`));
}

/** 结束在某个 rev 的版本。 */
export function versionAt(node: LiveNode, rev: number): NodeVersion | undefined {
  return node.versions.find((version) => version.rev === rev);
}

/** 复制一份版本表（事务回滚用）：还开着的那一版会被原地改。收口的正文不再改，共用。 */
export function cloneVersions(versions: NodeVersion[]): NodeVersion[] {
  return versions.map((version) => ({ ...version, by: version.by.map((by) => ({ ...by })) }));
}

/** 智能体读到的一个版本（`{"kind":"versions"}`）：结构化的数据，摘要由读的一方自己说。 */
export interface VersionSummary {
  n: number;
  baseRev: number;
  rev: number;
  start: string;
  end: string;
  by: { name: string; channel: 'human' | 'agent'; conversation?: string }[];
  open?: true;
  cut?: NodeVersion['cut'];
  restoredFrom?: number;
  /** 和前一版比改了几块（顶层块：新加、改过、删掉）；最早留着的一版没有可比的，不给。 */
  changed?: number;
  /** 改动所在的小节：改动块前面最近的标题，开头（第一个标题之前）是 ""。按出现顺序，最多 5 个。 */
  sections?: string[];
}

/** 列出正文的版本，新的在前。 */
export function listVersions(node: LiveNode): VersionSummary[] {
  const out: VersionSummary[] = [];
  let previous: ProseBlock[] | undefined;
  node.versions.forEach((version, index) => {
    const blocks = versionBlocks(node, version);
    const summary: VersionSummary = {
      n: version.n,
      baseRev: version.baseRev,
      rev: version.rev,
      start: version.start,
      end: version.end,
      by: version.by.map((by) => ({ name: by.name, channel: by.channel, ...(by.conversation ? { conversation: by.conversation } : {}) })),
      ...(index === node.versions.length - 1 && !version.blocks ? { open: true as const } : {}),
      ...(version.cut ? { cut: version.cut } : {}),
      ...(version.restoredFrom !== undefined ? { restoredFrom: version.restoredFrom } : {}),
    };
    if (previous) {
      const changes = changedBlocks(previous, blocks);
      summary.changed = changes.length;
      summary.sections = [...new Set(changes.map((change) => change.section))].slice(0, 5);
    }
    out.push(summary);
    previous = blocks;
  });
  return out.reverse();
}

/** 两版之间改了的顶层块（按块 id 对上），各带所在小节的标题。 */
export function changedBlocks(before: ProseBlock[], after: ProseBlock[]): { id: string; status: 'added' | 'changed' | 'removed'; section: string }[] {
  const old = new Map(before.map((block) => [block.id, block]));
  const kept = new Set(after.map((block) => block.id));
  const changes: { id: string; status: 'added' | 'changed' | 'removed'; section: string }[] = [];
  let section = '';
  for (const block of after) {
    if (isHeading(block)) section = plainText(block).trim();
    const was = old.get(block.id);
    if (!was) changes.push({ id: block.id, status: 'added', section });
    else if (signature(was) !== signature(block)) changes.push({ id: block.id, status: 'changed', section });
  }
  section = '';
  for (const block of before) {
    if (isHeading(block)) section = plainText(block).trim();
    if (!kept.has(block.id)) changes.push({ id: block.id, status: 'removed', section });
  }
  return changes;
}

function isHeading(block: ProseBlock): boolean {
  return block.type === 'paragraph' && block.heading !== undefined;
}

/** 块的内容（不含 rev：回到版本会给每块换新的 rev，内容没变）。 */
function signature(block: ProseBlock): string {
  return JSON.stringify(compressBlock(block), (key, value: unknown) => (key === 'rev' ? undefined : value));
}

/**
 * 编辑器版本面板的一行（`GET …/file/<标签页>/history`，原版的 `v3.checkpoint` 行）：每个版本一行，`params.upto` 是版本号，
 * 面板按它取 `at/<upto>`、`restore/<upto>`。行都带 `checkpoint.stored`：版本已经由服务端分好，面板不再按时间与人合并
 * （docs-runtime 的 comments/right-rail.tsx）。最新一版就是现在的正文（收口之后再改会另开一版；版本文件落后于正文时除外，按 rev 判断），
 * 标成 `cause: 'current'`：面板把它标作 Current，不给它「回到这个版本」（right-rail.tsx 的 BaoCut 补丁）。
 */
export function historyRows(node: LiveNode, pid: string, tabId: string): Record<string, unknown>[] {
  const last = node.versions[node.versions.length - 1];
  return node.versions
    .map((version) => {
      const current = version === last && (!version.blocks || version.rev === node.rev);
      const people = version.by.map(panelUser);
      const lead = people[people.length - 1] ?? { user: 'system', actor: 'system' };
      const id = `v3:${pid}:${tabId}:${version.n}`;
      return {
        id,
        originalId: id,
        v: 1,
        parentId: null,
        container: `project/${pid}`,
        versionId: null,
        ...lead,
        tool: 'v3.checkpoint',
        ns: 'v3',
        params: {
          key: `node/${node.id}`,
          upto: version.n,
          rev: version.rev,
          baseRev: version.baseRev,
          ...(version.restoredFrom !== undefined ? { restoredFrom: version.restoredFrom } : {}),
          checkpoint: { stored: true },
          ...(current ? { cause: 'current' } : {}),
          contributors: people,
        },
        paramHash: '',
        status: 'done',
        at: version.end,
        startedAt: version.start,
        endedAt: version.end,
        result: null,
        artifacts: null,
        anchor: null,
      };
    })
    .reverse();
}

/** 面板认的身份：人是 principal（邮箱形式），智能体是 `agent:<principal>`（面板显示为助手）。 */
function panelUser(author: VersionAuthor): { user: string; actor: string } {
  return { user: author.principal, actor: author.channel === 'agent' ? `agent:${author.principal}` : author.principal };
}

/** 版本号对应的版本。 */
export function versionNumbered(node: LiveNode, n: number): NodeVersion | undefined {
  return node.versions.find((version) => version.n === n);
}

/** 两份正文的内容一样（不比 rev）。 */
export function sameBlocks(a: ProseBlock[], b: ProseBlock[]): boolean {
  return a.length === b.length && a.every((block, index) => block.id === b[index]!.id && signature(block) === signature(b[index]!));
}
