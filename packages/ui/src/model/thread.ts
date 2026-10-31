import {
  intlLocale,
  live,
  planSummary,
  type AgentQuestion,
  type AgentQuestionAnswers,
  type ApprovalDecision,
  type ApprovalRequest,
  type HistoryEntry,
  type Id,
  type RiskLevel,
  type TimelineItem,
} from '@baocut/protocol';
import { PLAN_COPY } from '../components/thread/plan-copy.ts';
import { QUESTION_COPY } from '../components/thread/question-copy.ts';
import { ACCESS_MODE_LABEL, APPROVAL_COPY } from '../copy.ts';
import { baocutStep, type BaoCutStepKind } from './agent-tool-steps.ts';
import { shortenPath } from './format.ts';
import { M } from './thread-copy.ts';

type Item<K extends TimelineItem['kind']> = Extract<TimelineItem, { kind: K }>;

/**
 * 一组连续的执行过程（推理、工具调用与视频修改的回执），默认折叠成一行摘要（产品设计 §3.2.2）。
 * `undone`：这个会话里之后被撤销了的那些修改的事务 id（回执行据此写「已撤销」）。
 * `children`：子智能体的步骤，按父级工具调用的 id 归在它下面（`parentId`），不在 `items` 里、不进摘要。
 */
export interface StepsBlock {
  type: 'steps';
  id: Id;
  items: (Item<'reasoning'> | Item<'tool-call'> | Item<'video-change'>)[];
  undone: ReadonlySet<Id>;
  children: ReadonlyMap<Id, readonly Item<'tool-call'>[]>;
}

export type BotTimelineItem = Item<'work-item-ref'> | Item<'relay'> | Item<'proposal'>;

export type ThreadBlock =
  | { type: 'user'; id: Id; item: Item<'user-message'> }
  | { type: 'agent'; id: Id; item: Item<'agent-message'> }
  | StepsBlock
  | { type: 'approval'; id: Id; item: Item<'approval'> }
  | { type: 'notice'; id: Id; item: Item<'notice'> }
  /**
   * Bot 模式的条目（docs/design/bot-mode 技术方案 §4.3）：线程卡、报告与转交、提议卡。由 Bot 页提供的渲染器画
   * （thread/bot-items.ts），普通会话里没有渲染器时不占一行。提示（`suggestions`）不进线程，画在输入框上方。
   */
  | { type: 'bot'; id: Id; item: BotTimelineItem }
  /** 任务的状态行：放在这个任务的最后，写「已工作 X」或停止、失败的原因。 */
  | { type: 'task'; id: Id; item: Item<'task'> };

/**
 * 把条目排成线程块。按出现顺序；连续的步骤合并成一组；任务条目移到它的最后一个条目之后。
 * 视频修改的回执（产品设计 §6.5 变更卡）也是过程，与步骤收进同一组：两段文字之间只有一行摘要，回执在展开后按先后排。
 * 子智能体的步骤收在父级那一行下面，不占组里的一行、也不打断步骤组；找不到父级时（旧记录、分页没载到）按普通步骤排。
 */
export function buildThread(items: readonly TimelineItem[]): ThreadBlock[] {
  const tasks = new Map<Id, Item<'task'>>();
  const lastIndex = new Map<Id, number>();
  const undone = new Set<Id>();
  const tools = new Set<Id>();
  items.forEach((item, i) => {
    if (item.kind === 'task') tasks.set(item.id, item);
    if (item.kind === 'video-change' && item.undoOf) undone.add(item.undoOf);
    if (item.kind === 'tool-call') tools.add(item.id);
    if (item.taskId) lastIndex.set(item.taskId, i);
  });
  const children = new Map<Id, Item<'tool-call'>[]>();

  const blocks: ThreadBlock[] = [];
  let steps: StepsBlock | null = null;
  const flushTasksEndingAt = (i: number) => {
    for (const [taskId, task] of tasks) {
      if (lastIndex.get(taskId) === i) blocks.push({ type: 'task', id: `task-end/${taskId}`, item: task });
    }
  };

  items.forEach((item, i) => {
    // 新建视频、幻灯片、设计稿、设计系统与协作文档的记录不占一行、也不打断步骤组：视频卡由 video-cards.ts 挂在这一轮最后引用它的那一行后面，
    // 幻灯片、设计稿、设计系统与协作文档卡片同理。
    if (
      item.kind === 'video-created' ||
      item.kind === 'slides-created' ||
      item.kind === 'design-created' ||
      item.kind === 'design-system-created' ||
      item.kind === 'docs-created'
    ) {
      flushTasksEndingAt(i);
      return;
    }
    if (item.kind === 'tool-call' && item.parentId && item.parentId !== item.id && tools.has(item.parentId)) {
      const siblings = children.get(item.parentId);
      if (siblings) siblings.push(item);
      else children.set(item.parentId, [item]);
      flushTasksEndingAt(i);
      return;
    }
    if (item.kind === 'reasoning' || item.kind === 'tool-call' || item.kind === 'video-change') {
      if (item.kind === 'reasoning' && !item.text.trim()) {
        flushTasksEndingAt(i);
        return;
      }
      if (!steps) {
        steps = { type: 'steps', id: `steps/${item.id}`, items: [], undone, children };
        blocks.push(steps);
      }
      steps.items.push(item);
    } else {
      if (item.kind !== 'task') steps = null;
      switch (item.kind) {
        case 'user-message':
          blocks.push({ type: 'user', id: item.id, item });
          break;
        case 'agent-message':
          // 流式中还没有字的回复不占一行：这一轮在不在跑由回合页脚表达。
          if (item.text.trim()) blocks.push({ type: 'agent', id: item.id, item });
          break;
        case 'approval':
          blocks.push({ type: 'approval', id: item.id, item });
          break;
        case 'notice':
          blocks.push({ type: 'notice', id: item.id, item });
          break;
        case 'work-item-ref':
        case 'relay':
        case 'proposal':
          blocks.push({ type: 'bot', id: item.id, item });
          break;
        case 'suggestions':
        case 'task':
          break;
      }
    }
    flushTasksEndingAt(i);
  });
  return blocks;
}

/** BaoCut 自己的视频工具（Runtime 的 MCP 工具通道，服务名 `baocut`）。 */

function videoTool(item: Item<'tool-call'>): string | null {
  if (item.tool !== 'mcp' || !item.title.startsWith('baocut.')) return null;
  return item.title.slice('baocut.'.length);
}

/** 步骤行的标题：视频工具写成动作（`M.videoTools`），修改带上它的说明；其余照原样。 */
export function toolTitle(item: Item<'tool-call'>): string {
  const name = videoTool(item);
  const action = name && Object.hasOwn(M.videoTools, name) ? M.videoTools[name] : undefined;
  if (!action) return item.title;
  let label: unknown;
  try {
    label = item.detail ? (JSON.parse(item.detail) as { label?: unknown }).label : undefined;
  } catch {
    label = undefined;
  }
  return typeof label === 'string' && label ? M.toolTitle(action, label) : action;
}

/** 步骤行的类别（产品设计 §3.2.2）：协议的工具种类没有「读取」，读取与搜索由 `(tool, title)` 推出来。 */
export type StepKind = 'command' | 'read' | 'edit' | 'search' | 'fetch' | 'agent' | 'other';

export const STEP_LABELS: Record<StepKind, string> = live(() => M.steps);

/**
 * 没有结构化事实（`info`）的旧记录：Claude Driver 把读、搜一类的自带工具记成 `other`，标题是「<工具名> <简述>」
 * （agent-drivers 的 claude-items）：`Read <路径>`，`Grep <模式> · <路径>`，`Glob <模式> · <路径>`。
 */
const READ_TITLE = /^Read(?:\s+(.*))?$/;
const SEARCH_TITLE = /^(?:Grep|Glob)(?:\s+(.*))?$/;

/** 路径相对会话工作目录（工作目录下的绝对路径去掉前缀，`./` 去掉）。 */
export function relativePath(path: string, cwd?: string | null): string {
  if (path.startsWith('./')) return path.slice(2);
  if (cwd && path.startsWith('/')) {
    const root = cwd.replace(/\/+$/, '');
    if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  }
  return path;
}

/** 改动步骤涉及的文件（含删除）：Codex 每行「<类型> <路径>」，Claude 是「<工具名> <路径>」；都没有就取标题。 */
function editPaths(item: Item<'tool-call'>): string[] {
  const fromDetail = (item.detail ?? '').split('\n').flatMap((line) => {
    const space = line.indexOf(' ');
    const path = space > 0 ? line.slice(space + 1).trim() : '';
    return path ? [path] : [];
  });
  if (fromDetail.length) return fromDetail;
  return item.title
    .split(', ')
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * 一次工具调用的类别、固定类别名与次级摘要（命令本身、相对路径、查询词）。BaoCut 自己的工具念它自己的类别名与参数摘要
 * （agent-tool-steps.ts），`tool` 是它的类别键（图标按它取），组头摘要仍算「调用了工具」。
 */
export function toolStep(
  item: Item<'tool-call'>,
  cwd?: string | null,
): { kind: StepKind; label: string; summary: string; tool?: BaoCutStepKind } {
  const step = (kind: StepKind, summary: string) => ({ kind, label: STEP_LABELS[kind], summary: summary.trim() });
  const info = item.info;
  switch (info?.type) {
    case 'read':
      return step('read', relativePath(info.path, cwd));
    case 'search':
      return step('search', info.path ? `${info.pattern} · ${relativePath(info.path, cwd)}` : info.pattern);
    case 'fetch':
      return step('fetch', info.url);
    case 'subAgent':
      return step('agent', info.description ?? toolTitle(item));
  }
  switch (item.tool) {
    case 'command':
      return step('command', item.title);
    case 'file-change':
      return step(
        'edit',
        editPaths(item)
          .map((p) => relativePath(p, cwd))
          .join(', '),
      );
    case 'web-search':
      return step('search', item.title);
    case 'other': {
      const read = READ_TITLE.exec(item.title);
      if (read) return step('read', relativePath(read[1] ?? '', cwd));
      const search = SEARCH_TITLE.exec(item.title);
      if (search) return step('search', search[1] ?? '');
      return step('other', toolTitle(item));
    }
    case 'mcp': {
      const baocut = baocutStep(item);
      if (baocut) return { kind: 'other', label: baocut.label, summary: baocut.summary, tool: baocut.kind };
      return step('other', toolTitle(item));
    }
  }
}

/** 文件计数用的路径：读取取摘要里的路径，修改取改动涉及的每个文件。 */
function stepPaths(item: Item<'tool-call'>, kind: StepKind, cwd?: string | null): string[] {
  if (kind === 'edit') return editPaths(item).map((p) => relativePath(p, cwd));
  if (kind === 'read') return [toolStep(item, cwd).summary];
  return [];
}

/**
 * 一组步骤的一句话摘要：按种类首次出现的顺序归纳，读取与修改按去重后的路径计数，
 * 视频修改按回执计笔数（「读取了 2 个文件、运行了命令」）。只有思考时写「思考」。
 *
 * 笔数只数回执：提交视频修改的工具在调用里放回执（`edits_apply` 之外，转写、翻译这些也会提交），
 * 一次成功的 `edits_apply` 既是一次工具调用又有一张回执，按调用数会重复，失败的调用又没有提交。
 */
export function stepsSummary(items: StepsBlock['items'], cwd?: string | null): string {
  type Key = Exclude<StepKind, 'other'> | 'video' | 'tool';
  const order: Key[] = [];
  const paths: Partial<Record<Key, Set<string>>> = {};
  let videoEdits = 0;
  for (const item of items) {
    if (item.kind === 'video-change') {
      if (!order.includes('video')) order.push('video');
      videoEdits++;
      continue;
    }
    if (item.kind !== 'tool-call') continue;
    const { kind } = toolStep(item, cwd);
    const key: Key = kind === 'other' ? 'tool' : kind;
    if (!order.includes(key)) order.push(key);
    for (const path of stepPaths(item, kind, cwd)) (paths[key] ??= new Set()).add(path);
  }
  const P = M.phrase;
  const phrase: Record<Key, string> = {
    command: P.command,
    read: P.read(paths.read?.size ?? 0),
    edit: P.edit(paths.edit?.size ?? 0),
    search: P.search,
    fetch: P.fetch,
    agent: P.agent,
    video: P.video(videoEdits),
    tool: P.tool,
  };
  if (order.length) return M.summary(order.map((key) => phrase[key]));
  return items.some((i) => i.kind === 'reasoning') ? M.thinking : M.stepsFallback;
}

/**
 * 文件改动步骤里改了哪些文件。Codex Driver 把每个改动写成一行「<类型> <路径>」（agent-drivers 的 map-item）。
 * 删掉的文件不给打开。
 */
export function changedFiles(item: Item<'tool-call'>): { path: string; change: string }[] {
  if (item.tool !== 'file-change' || !item.detail) return [];
  return item.detail.split('\n').flatMap((line) => {
    const space = line.indexOf(' ');
    if (space <= 0) return [];
    const change = line.slice(0, space);
    const path = line.slice(space + 1).trim();
    return path && change !== 'delete' ? [{ path, change }] : [];
  });
}

// ---- 审批卡 ----

/**
 * 审批卡的标题、动作种类、显示的输入摘要与复制用的全文（原型 agent-thread.jsx `PermissionMsg`）。
 * 工具调用的输入是工具名加目标；参数摘要在 `reason` 里，卡片另起一行写。`risk` 取时间线条目上的（旧记录没有）。
 */
export function approvalSummary(
  request: ApprovalRequest,
  risk?: RiskLevel,
): { title: string; kind: string; subject: string; copyText: string } {
  switch (request.kind) {
    case 'command':
      return { title: APPROVAL_COPY.title.command, kind: APPROVAL_COPY.kind.command, subject: request.command, copyText: request.command };
    case 'file-change':
      return {
        title: APPROVAL_COPY.title['file-change'],
        kind: APPROVAL_COPY.kind['file-change'],
        subject: request.files.length ? request.files.map(shortenPath).join('\n') : APPROVAL_COPY.projectFiles,
        copyText: request.files.length ? request.files.join('\n') : APPROVAL_COPY.projectFiles,
      };
    case 'tool':
      return {
        title: risk === 'high' ? APPROVAL_COPY.title.highRisk : APPROVAL_COPY.title.tool,
        kind: APPROVAL_COPY.kind.tool,
        subject: [request.tool, ...request.files.map(shortenPath)].join('\n'),
        copyText: [request.tool, ...request.files].join('\n'),
      };
    case 'question': {
      const text = request.questions.map((q) => q.question).join('\n');
      const n = request.questions.length;
      return { title: n > 1 ? QUESTION_COPY.titleMany(n) : QUESTION_COPY.title, kind: QUESTION_COPY.kind, subject: text, copyText: text };
    }
    case 'plan':
      return { title: PLAN_COPY.title, kind: PLAN_COPY.kind, subject: planSummary(request.plan), copyText: request.plan };
  }
}

/**
 * 决定过的审批收成一行时写什么（原型 `PermissionMsg` 的 `label`）。规则或访问模式自动允许的，写原型
 * `autoAllowLabel` 那一行；用户点的「总是允许」写「之后 <规则> 不再问」。
 *
 * 用户点的答案取时间线上的 `decision`；早先的记录没有它，退回 `chosen`（这个窗口里刚点过的答案），
 * 两样都没有就写「已允许」。
 * 原型还分「编辑」「应答环」两种自动允许；`decidedBy: 'auto'` 分不出是哪一档放行的，一律写「访问模式」。
 */
export function approvalDecidedLabel(item: Item<'approval'>, chosen: ApprovalDecision | undefined): string {
  const rule = item.request.rule ?? null;
  switch (item.status) {
    case 'accepted':
      if (item.decidedBy === 'rule') return APPROVAL_COPY.autoRule(rule);
      if (item.decidedBy === 'auto') return APPROVAL_COPY.autoMode;
      return (item.decision ?? chosen) === 'accept-always' && rule ? APPROVAL_COPY.acceptedAlways(rule) : APPROVAL_COPY.accepted;
    case 'declined':
      return APPROVAL_COPY.declined;
    case 'cancelled':
      return APPROVAL_COPY.cancelled;
    case 'pending':
      return '';
  }
}

// ---- 方案卡 ----

/** 方案卡收起后那一行写什么：批准的带上实施时切到的访问模式。 */
export function planDecidedLabel(item: Item<'approval'>): string {
  switch (item.status) {
    case 'accepted':
      return item.implementMode ? PLAN_COPY.approved(ACCESS_MODE_LABEL[item.implementMode]) : APPROVAL_COPY.accepted;
    case 'declined':
      return item.answeredByMessage ? PLAN_COPY.byMessage : PLAN_COPY.declined;
    case 'cancelled':
      return PLAN_COPY.cancelled;
    case 'pending':
      return '';
  }
}

// ---- 提问卡 ----

/** 提问卡上「其他」那一项的值（不会和选项名撞上）。 */
export const OTHER_OPTION = '\u0000other';

/** 提问卡的草稿：每题选中的选项名（可能含 `OTHER_OPTION`），与「其他」里写的字。 */
export interface QuestionDraft {
  picked: Record<string, string[]>;
  other: Record<string, string>;
}

/** 填空题：没有选项，只有一个输入框（Pi 扩展的 input / editor，或智能体只给了问题）。写的字记在草稿的 `other` 里。 */
export function questionIsFillIn(question: AgentQuestion): boolean {
  return question.options.length === 0;
}

/**
 * 草稿 → 要交的答案。选了「其他」但没写字的不算；有一题没答就返回 null（「发送回答」不可用）。
 * 单选题只取第一个；填空题按选了「其他」算。
 */
export function questionDraftAnswers(questions: AgentQuestion[], draft: QuestionDraft): AgentQuestionAnswers | null {
  const answers: AgentQuestionAnswers = {};
  for (const q of questions) {
    const picked = questionIsFillIn(q) ? [OTHER_OPTION] : (draft.picked[q.id] ?? []);
    const other = picked.includes(OTHER_OPTION) ? (draft.other[q.id] ?? '').trim() : '';
    const values = [...picked.filter((v) => v !== OTHER_OPTION), ...(other ? [other] : [])];
    if (values.length === 0) return null;
    answers[q.id] = q.multiSelect ? values : values.slice(0, 1);
  }
  return answers;
}

/** 提问卡收起后那一行写什么。 */
export function questionDecidedLabel(item: Item<'approval'>): string {
  switch (item.status) {
    case 'accepted':
      return QUESTION_COPY.answered;
    case 'declined':
      return item.answeredByMessage ? QUESTION_COPY.byMessage : QUESTION_COPY.skipped;
    case 'cancelled':
      return QUESTION_COPY.cancelled;
    case 'pending':
      return '';
  }
}

/** 一道题的答案写成一句（按当前语言的并列写法）；没答的写「没有回答」。 */
export function questionAnswerText(answers: AgentQuestionAnswers | undefined, questionId: string): string {
  const picked = answers?.[questionId] ?? [];
  return picked.length ? new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(picked) : QUESTION_COPY.noAnswer;
}

// ---- 变更卡的撤销与恢复 ----

/** 这个窗口里对这张卡做过的最后一个动作：撤销（得到补偿事务 U），或恢复（撤销 U，得到 R）。 */
export type LocalUndoAction = { kind: 'undo'; transactionId: Id } | { kind: 'restore'; transactionId: Id };

export type ChangeUndoState =
  | { state: 'applied' }
  /** `restore`：能恢复时是要撤销的那笔补偿事务（撤销它就是把这一步放回去），否则为 null。 */
  | { state: 'undone'; restore: Id | null };

/**
 * 变更卡是「已撤销」还是仍然生效，以及能不能「恢复」。
 *
 * - 编辑器开着这个视频时有历史（`history`）：从这一笔起顺着 `undoneBy` 走，被撤销奇数次就是已撤销，
 *   链上最后一笔（奇数层的撤销）是恢复时要撤销的那一笔。
 * - 没有历史（视频没开着），或历史还没包含本窗口刚做的动作：按本窗口的动作，再不然按会话里记下的撤销（`undoneInThread`）。
 * - 只有那一笔正是当前连接的「重做」栈顶（`redo`，来自 edits.undoState）时才给恢复。撤销是补偿事务：
 *   不是栈顶时（你之后又改过这个视频，或撤销是 Agent 做的）没法可靠地判断撤销它等于把这一步放回去，不画「恢复」。
 */
export function changeUndoState(input: {
  transactionId: Id;
  undoneInThread: boolean;
  local: LocalUndoAction | null;
  history: readonly HistoryEntry[] | null;
  redo: Id | null;
}): ChangeUndoState {
  const { transactionId, undoneInThread, local, history, redo } = input;
  const undone = (undo: Id): ChangeUndoState => ({ state: 'undone', restore: redo === undo ? undo : null });
  const byId = history ? new Map(history.map((entry) => [entry.transactionId, entry])) : null;
  if (byId?.has(transactionId) && (!local || byId.has(local.transactionId))) {
    let current = transactionId;
    let flips = 0;
    const seen = new Set<Id>([transactionId]);
    for (let next = byId.get(current)?.undoneBy; next && !seen.has(next); next = byId.get(current)?.undoneBy) {
      seen.add(next);
      current = next;
      flips++;
    }
    return flips % 2 === 1 ? undone(current) : { state: 'applied' };
  }
  if (local) return local.kind === 'undo' ? undone(local.transactionId) : { state: 'applied' };
  return undoneInThread ? { state: 'undone', restore: null } : { state: 'applied' };
}
