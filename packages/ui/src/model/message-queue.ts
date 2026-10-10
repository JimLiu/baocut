/*
 * 忙时排队：会话有任务在跑时发的话先排着，任务结束后按顺序发出；也可以「立即发送」插进当前回合。
 *
 * 「先移出队列、发送失败再放回队首」的做法移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra）
 * packages/app/src/composer/actions.ts（`sendQueuedComposerMessageNow`、`editQueuedComposerMessage`），modified：
 * 立即发送先走 `conversations.steer`，按它的结果决定移出、留在队列还是改走 `conversations.send`；队列按会话存在 shell-store。
 */
import { sendSkillRefs, type AttachmentRef, type EditorContext, type Id, type SkillSendRef } from '@baocut/protocol';

export interface QueuedMessage {
  id: Id;
  text: string;
  /** 入队前已经上传完的图片。 */
  attachments: AttachmentRef[];
  /** 入队那一刻编辑器的状态；走 `conversations.send` 时带上（`steer` 不收上下文）。 */
  context?: EditorContext;
  /** 点选的 skill，按挂上的顺序；走 `conversations.send` 时带上（`steer` 不收 skill，带 skill 的不插话，等这一轮结束再发）。 */
  skills?: SkillSendRef[];
  queuedAt: string;
}

export function enqueueMessage(queue: readonly QueuedMessage[], message: QueuedMessage): QueuedMessage[] {
  return [...queue, message];
}

export function removeQueuedMessage(queue: readonly QueuedMessage[], id: Id): QueuedMessage[] {
  return queue.filter((m) => m.id !== id);
}

/** 改排队的文字；改成空的就是删掉（消息必须有正文，图片不能单独发）。 */
export function editQueuedMessage(queue: readonly QueuedMessage[], id: Id, text: string): QueuedMessage[] {
  const trimmed = text.trim();
  return queue.flatMap((m) => {
    if (m.id !== id) return [m];
    return trimmed ? [{ ...m, text: trimmed }] : [];
  });
}

function isSkillRef(value: unknown): value is SkillSendRef {
  return !!value && typeof value === 'object' && typeof (value as SkillSendRef).id === 'string';
}

/** 读回持久化的一条：形状不对的不要。只能点一个 skill 时存的 `skill` 也认（`readQueuedMessage` 把它换成 `skills`）。 */
export function isQueuedMessage(value: unknown): value is QueuedMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.text === 'string' &&
    typeof m.queuedAt === 'string' &&
    Array.isArray(m.attachments) &&
    m.attachments.every((a) => !!a && typeof a === 'object' && typeof (a as AttachmentRef).id === 'string') &&
    (m.context === undefined || (!!m.context && typeof m.context === 'object')) &&
    (m.skill === undefined || isSkillRef(m.skill)) &&
    (m.skills === undefined || (Array.isArray(m.skills) && m.skills.every(isSkillRef)))
  );
}

/** 读回持久化的一条，旧的单个 `skill` 换成 `skills`；形状不对时为 null。 */
export function readQueuedMessage(value: unknown): QueuedMessage | null {
  if (!isQueuedMessage(value)) return null;
  const { skill, skills, ...base } = value as QueuedMessage & { skill?: SkillSendRef };
  const refs = sendSkillRefs({ ...(skill ? { skill } : {}), ...(skills ? { skills } : {}) });
  return refs.length ? { ...base, skills: refs } : base;
}

/** 一条会话的队列：读最新的，整条写回。 */
export interface QueueAccess {
  read(): readonly QueuedMessage[];
  write(next: QueuedMessage[]): void;
}

export type SteerStatus = 'steered' | 'unsupported' | 'no-active-turn';

export interface QueueTransport {
  steer(message: QueuedMessage): Promise<SteerStatus>;
  send(message: QueuedMessage): Promise<void>;
}

export type QueueSendResult =
  | { status: 'missing' }
  /** 插进了当前回合，移出队列。 */
  | { status: 'steered' }
  /** 没有在跑的回合，直接发了一条新消息。 */
  | { status: 'sent' }
  /** Agent 不支持插话：放回队首，当前任务结束后先发它。 */
  | { status: 'deferred' }
  /** 发送出错：放回队首。 */
  | { status: 'failed'; error: string };

/**
 * 「立即发送」：先移出队列（同一条不会被任务结束时的自动发送再发一次），再试着插进当前回合。
 * `steered` 就此移出；`unsupported` 放回队首等任务结束；`no-active-turn` 说明任务刚好结束了，直接发送。
 */
export async function sendQueuedNow(queue: QueueAccess, transport: QueueTransport, id: Id): Promise<QueueSendResult> {
  const item = queue.read().find((m) => m.id === id);
  if (!item) return { status: 'missing' };
  queue.write(removeQueuedMessage(queue.read(), id));
  try {
    const status = await transport.steer(item);
    if (status === 'steered') return { status: 'steered' };
    if (status === 'unsupported') {
      queue.write([item, ...queue.read()]);
      return { status: 'deferred' };
    }
    await transport.send(item);
    return { status: 'sent' };
  } catch (error) {
    queue.write([item, ...queue.read()]);
    return { status: 'failed', error: (error as Error).message };
  }
}

/** 任务结束后发出队首那一条。失败放回队首，不重试：等下一次任务结束，或用户自己点「立即发送」。 */
export async function sendQueueHead(queue: QueueAccess, transport: Pick<QueueTransport, 'send'>): Promise<QueueSendResult> {
  const item = queue.read()[0];
  if (!item) return { status: 'missing' };
  queue.write(removeQueuedMessage(queue.read(), item.id));
  try {
    await transport.send(item);
    return { status: 'sent' };
  } catch (error) {
    queue.write([item, ...queue.read()]);
    return { status: 'failed', error: (error as Error).message };
  }
}
