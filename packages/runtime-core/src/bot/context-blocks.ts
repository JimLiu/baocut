// i18n-ignore-file: 交给智能体的上下文块（英文标签与字段名）
import { contextBlock, escapeContextTags } from '@baocut/harness';
import {
  BOT_LIMITS,
  type CitedMessage,
  type Id,
  type ResourceRef,
  type ThreadReport,
  type WorkItem,
  type WorkItemQuestion,
} from '@baocut/protocol';
import { stateName } from './work-item-machine.ts';

/*
 * Runtime 交给智能体的结构化文字（技术方案 §13.1）：都经 `contextBlock` 逐行转义，素材里的 `<baocut-…>` 伪造不出块边界。
 * 属性值另外转义引号与尖括号。
 */

function attr(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, ' ');
}

function lines(text: string): string[] {
  return text.split('\n');
}

export function resourceLine(ref: ResourceRef): string {
  switch (ref.kind) {
    case 'video':
      return `video project=${ref.projectId} video=${ref.videoId}`;
    case 'video-range':
      return `video-range project=${ref.projectId} video=${ref.videoId} ${ref.startMs}-${ref.endMs}ms`;
    case 'file':
      return `file ${ref.path}`;
    case 'space':
      return `space entry=${ref.entryId}`;
    case 'message':
      return `message conversation=${ref.conversationId} item=${ref.itemId}`;
    case 'work-item':
      return `task ${ref.workItemId}`;
    default:
      return `${ref.kind} ${ref.id}`;
  }
}

function questionLines(question: WorkItemQuestion | null): string[] {
  if (!question) return [];
  return [
    `question (${question.kind}${question.risky ? ', risky' : ''}): ${question.text}`,
    ...question.options.map((o, i) => `  option ${i}${question.pick === i ? ' (recommended)' : ''}: ${o.label}${o.description ? ` (${o.description})` : ''}`),
  ];
}

/** 用户原话或协调者的话（§8.2）：作者与 `via` 由 Runtime 填，智能体伪造不了。 */
export function citedBlock(cited: CitedMessage): string {
  const via = cited.via ? ` via="${attr(cited.via)}"` : '';
  return contextBlock(
    `<baocut-cited author="${cited.author}"${via} id="${attr(cited.messageId)}" at="${attr(cited.at)}"${cited.truncated ? ' truncated="true"' : ''}>`,
    lines(cited.text),
    '</baocut-cited>',
  );
}

/** 协调者写的早先结论（§13.4）：和 Runtime 现取的事实分开。 */
export function earlierFindingsBlock(text: string, asOf: string): string {
  return contextBlock(`<baocut-earlier-findings asOf="${attr(asOf)}">`, lines(text), '</baocut-earlier-findings>');
}

export interface BriefInput {
  item: WorkItem;
  brief: string;
  cited: CitedMessage[];
  channelName: string;
  rules: string | null;
  notesPath: string;
  fileOwnership: string | null;
  outputLanguage: string | null;
  asOf: string;
}

/** 线程的第一回合（§7.2）。 */
export function threadBriefBlock(input: BriefInput): string {
  const { item } = input;
  const head = contextBlock(
    `<baocut-thread-brief task="${attr(item.id)}" channel="${attr(input.channelName)}">`,
    [
      `title: ${item.title}`,
      ...(item.description ? [`description: ${item.description}`] : []),
      `owner: ${item.owner}`,
      ...(item.dueOn ? [`due: ${item.dueOn}`] : []),
      ...(item.eventOn ? [`event day: ${item.eventOn}`] : []),
      ...item.resources.map((r) => `resource: ${resourceLine(r)}`),
      `working notes: ${input.notesPath}`,
      ...(input.fileOwnership ? [`file ownership: ${input.fileOwnership}`] : []),
      ...(input.rules ? ['channel rules:', ...lines(input.rules)] : []),
    ],
    '</baocut-thread-brief>',
  );
  const contract = input.outputLanguage ? `<baocut-task-contract outputLanguage="${attr(input.outputLanguage)}"/>` : null;
  return [
    head,
    ...(contract ? [contract] : []),
    ...(input.brief.trim() ? [earlierFindingsBlock(input.brief, input.asOf)] : []),
    ...input.cited.map(citedBlock),
  ].join('\n');
}

/** 协调者转给线程的补充（§8.2）；`kind: 'edited'` 是用户改了已转交的消息。 */
export function relayBlock(input: { workItemId: Id; note: string; cited: CitedMessage[]; kind?: 'relay' | 'edited'; asOf: string }): string {
  return [
    contextBlock(
      `<baocut-relay task="${attr(input.workItemId)}"${input.kind === 'edited' ? ' kind="edited"' : ''}>`,
      input.note.trim() ? lines(input.note) : [],
      '</baocut-relay>',
    ),
    ...input.cited.map(citedBlock),
  ].join('\n');
}

/** 一份线程报告（§8.3），可以一回合多个；被覆盖的那份的 headline 一并列出。 */
export function threadReportBlock(report: ThreadReport, item: WorkItem | undefined, superseded: string[] = []): string {
  return contextBlock(
    `<baocut-thread-report task="${attr(report.workItemId)}" stop="${report.stop}"${report.fallback ? ' fallback="true"' : ''}>`,
    [
      `title: ${item?.title ?? report.workItemId}`,
      `headline: ${report.headline}`,
      ...questionLines(report.question),
      ...report.outputs.map((o) => `output: ${o.label} (${resourceLine(o)})`),
      ...report.userTodos.map((t) => `for the user: ${t}`),
      ...superseded.map((h) => `earlier report (superseded): ${h}`),
      ...(report.text ? ['', ...lines(report.text)] : []),
    ],
    '</baocut-thread-report>',
  );
}

export interface ChannelStateInput {
  now: Date;
  timeZone: string;
  lang: string | null;
  items: WorkItem[];
  memoryVersion: number;
  rules: string | null;
}

/** 每回合前置（§13.2）：未解决任务的紧凑列表与规则；超出上限时只列需要你的与工作中的。 */
export function channelStateBlock(input: ChannelStateInput): string {
  const open = input.items.filter((i) => i.status !== 'resolved');
  const row = (i: WorkItem) => {
    const q = i.question ? ` | asks: ${i.question.text}` : '';
    const due = i.dueOn ? ` | due ${i.dueOn}` : '';
    const reason = i.active?.reason ? ` | ${i.active.reason}` : '';
    return `- ${i.id} [${stateName(i)}${i.owner === 'user' ? ', user' : ''}] ${i.title}${due}${reason}${q}`;
  };
  const head = [
    `now: ${formatLocal(input.now, input.timeZone)} (${input.timeZone})`,
    ...(input.lang ? [`conversation language: ${input.lang}`] : []),
    `memory version: ${input.memoryVersion}`,
  ];
  const rules = input.rules ? ['rules from memory:', ...lines(input.rules)] : [];
  let rows = open.map(row);
  const size = () => [...head, ...rows, ...rules].join('\n').length;
  if (size() > BOT_LIMITS.channelStateChars) {
    const priority = open.filter((i) => i.status === 'active' && i.active?.state !== 'waitingOnOthers');
    rows = [...priority.map(row), `(${open.length - priority.length} more tasks not listed; use work_items_list)`];
  }
  return contextBlock('<baocut-channel-state>', [...head, open.length ? 'open tasks:' : 'open tasks: none', ...rows, ...rules], '</baocut-channel-state>');
}

export function replyTargetBlock(workItemId: Id): string {
  return `<baocut-reply-target work-item="${attr(workItemId)}"/>`;
}

export function ambiguousAnswerBlock(items: WorkItem[]): string {
  return contextBlock(
    '<baocut-ambiguous-answer>',
    ['The user replied briefly and more than one task is waiting on them. Ask which one before acting:', ...items.map((i) => `- ${i.id} ${i.title}`)],
    '</baocut-ambiguous-answer>',
  );
}

/** 刷新或「继续」（§9.3）：上次以来的变化。 */
export function refreshBlock(reason: string, changes: string[]): string {
  return contextBlock(`<baocut-refresh reason="${attr(reason)}">`, changes.length ? changes : ['No recorded changes since the last report.'], '</baocut-refresh>');
}

export function workspaceFactsBlock(facts: string[]): string {
  return contextBlock('<baocut-workspace-facts>', facts.length ? facts : ['No projects yet.'], '</baocut-workspace-facts>');
}

export function userMemoryBlock(content: string): string | null {
  return content.trim() ? contextBlock('<baocut-user-memory>', lines(content), '</baocut-user-memory>') : null;
}

export function handoffBlock(input: { memory: string; items: WorkItem[]; transcript: string[]; todo: string[] }): string {
  return contextBlock(
    '<baocut-channel-handoff>',
    [
      'You are continuing this channel from an earlier session. Do not greet the user again.',
      'channel memory:',
      ...(input.memory.trim() ? lines(input.memory) : ['(empty)']),
      'open tasks:',
      ...input.items.filter((i) => i.status !== 'resolved').map((i) => `- ${i.id} [${stateName(i)}] ${i.title}`),
      ...(input.todo.length ? ['last plan:', ...input.todo] : []),
      'recent conversation:',
      ...input.transcript,
    ],
    '</baocut-channel-handoff>',
  );
}

export function purposeBlock(purpose: string): string {
  return contextBlock('<baocut-channel-purpose>', lines(purpose || '(none)'), '</baocut-channel-purpose>');
}

/** 「规则」一节：频道记忆里以 `## Rules`（或「规则」）开头的那一节。 */
export function rulesSection(memory: string): string | null {
  const match = /^##\s*(rules|规则)\s*$/im.exec(memory);
  if (!match) return null;
  const rest = memory.slice(match.index + match[0].length);
  const end = /^##\s/m.exec(rest);
  const body = (end ? rest.slice(0, end.index) : rest).trim();
  return body || null;
}

/** 用户时区里的「YYYY-MM-DD HH:mm 星期」。时区不认识时按 UTC。 */
export function formatLocal(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('weekday')}`;
  } catch {
    return date.toISOString();
  }
}

/** 用户时区里的日期 YYYY-MM-DD。 */
export function localDay(date: Date, timeZone: string): string {
  return formatLocal(date, timeZone).slice(0, 10);
}

export { escapeContextTags };
