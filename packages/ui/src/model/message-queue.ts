/*
 * 忙时排队：会话有任务在跑时发的话先排着，任务结束后按顺序发出；也可以「立即发送」插进当前回合。
 *
 * 「先移出队列、发送失败再放回队首」的做法移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra）
 * packages/app/src/composer/actions.ts（`sendQueuedComposerMessageNow`、`editQueuedComposerMessage`），modified：
 * 立即发送先走 `conversations.steer`，按它的结果决定移出、留在队列还是改走 `conversations.send`；队列按会话存在 shell-store。
 */
import { sendSkillRefs, type AttachmentRef, type EditorContext, type Id, type SkillSendRef, type SlideAnnotation, type DesignAnnotation, type DesignSystemAnnotation, type VideoAnnotation, type DocsAnnotation } from '@baocut/protocol';

export interface QueuedMessage {
  id: Id;
  text: string;
  /** 入队前已经上传完的图片。 */
  attachments: AttachmentRef[];
  /** 入队那一刻编辑器的状态；走 `conversations.send` 时带上（`steer` 不收上下文）。 */
  context?: EditorContext;
  /** 点选的 skill，按挂上的顺序；走 `conversations.send` 时带上（`steer` 不收 skill，带 skill 的不插话，等这一轮结束再发）。 */
  skills?: SkillSendRef[];
  /** 加进对话的幻灯片标注（docs/design/slides §8.2）；`send` 与 `steer` 都带上。 */
  slideAnnotations?: SlideAnnotation[];
  /** 加进对话的设计稿标注（docs/design/canvas §8.2）；同幻灯片标注。 */
  designAnnotations?: DesignAnnotation[];
  /** 加进对话的设计系统标注（docs/design/canvas §10.6）；同幻灯片标注。 */
  designSystemAnnotations?: DesignSystemAnnotation[];
  /** 加进对话的视频标注（产品设计 §3.2.3「视频标注」）；同幻灯片标注。 */
  videoAnnotations?: VideoAnnotation[];
  /** 发给智能体的协作文档评论与请求（docs/design/docs §8）；同幻灯片标注。 */
  docsAnnotations?: DocsAnnotation[];
  /** 用户点掉了「品牌：BRAND.md」：走 `conversations.send` 时不带项目的 `BRAND.md`（`steer` 不收，带它的不插话）。 */
  skipProjectBrand?: boolean;
  queuedAt: string;
}

export function enqueueMessage(queue: readonly QueuedMessage[], message: QueuedMessage): QueuedMessage[] {
  return [...queue, message];
}

export function removeQueuedMessage(queue: readonly QueuedMessage[], id: Id): QueuedMessage[] {
  return queue.filter((m) => m.id !== id);
}

/** 改排队的文字；改成空的就是删掉（消息必须有正文，图片与标注不能单独发）。 */
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

/** 持久化的一条幻灯片标注：只核对形状，长度与条数由 Runtime 的 schema 把关。 */
function isSlideAnnotation(value: unknown): value is SlideAnnotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    !!a.deck &&
    typeof a.deck === 'object' &&
    typeof a.anchor === 'string' &&
    typeof a.label === 'string' &&
    typeof a.text === 'string' &&
    (a.slideId === undefined || typeof a.slideId === 'string') &&
    (a.detail === undefined || typeof a.detail === 'string') &&
    (a.area === undefined || typeof a.area === 'boolean')
  );
}

/** 持久化的一条设计稿标注：同幻灯片标注，只核对形状。 */
function isDesignAnnotation(value: unknown): value is DesignAnnotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    !!a.canvas &&
    typeof a.canvas === 'object' &&
    typeof a.anchor === 'string' &&
    typeof a.label === 'string' &&
    typeof a.text === 'string' &&
    (a.board === undefined || typeof a.board === 'string') &&
    (a.detail === undefined || typeof a.detail === 'string') &&
    (a.area === undefined || typeof a.area === 'boolean')
  );
}

/** 持久化的一条设计系统标注：同幻灯片标注，只核对形状。 */
function isDesignSystemAnnotation(value: unknown): value is DesignSystemAnnotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    !!a.system &&
    typeof a.system === 'object' &&
    typeof a.anchor === 'string' &&
    typeof a.label === 'string' &&
    typeof a.text === 'string' &&
    (a.section === undefined || typeof a.section === 'string') &&
    (a.detail === undefined || typeof a.detail === 'string')
  );
}

const isUnit = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;

/** 持久化的一条视频标注：同幻灯片标注，只核对形状。 */
function isVideoAnnotation(value: unknown): value is VideoAnnotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  const region = a.region as Record<string, unknown> | undefined;
  const to = a.to as Record<string, unknown> | undefined;
  return (
    !!a.video &&
    typeof a.video === 'object' &&
    typeof a.revision === 'string' &&
    typeof a.timeMs === 'number' &&
    (a.kind === 'box' || a.kind === 'arrow' || a.kind === 'text' || a.kind === 'pin') &&
    !!region &&
    typeof region === 'object' &&
    isUnit(region.x) &&
    isUnit(region.y) &&
    isUnit(region.w) &&
    isUnit(region.h) &&
    (to === undefined || (!!to && typeof to === 'object' && isUnit(to.x) && isUnit(to.y))) &&
    typeof a.label === 'string' &&
    typeof a.text === 'string'
  );
}

/** 持久化的一条协作文档标注：同幻灯片标注，只核对形状。 */
function isDocsAnnotation(value: unknown): value is DocsAnnotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    !!a.doc &&
    typeof a.doc === 'object' &&
    (a.kind === 'comment' || a.kind === 'ask') &&
    typeof a.path === 'string' &&
    typeof a.label === 'string' &&
    typeof a.text === 'string' &&
    (a.quote === undefined || typeof a.quote === 'string')
  );
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
    (m.skills === undefined || (Array.isArray(m.skills) && m.skills.every(isSkillRef))) &&
    (m.slideAnnotations === undefined || (Array.isArray(m.slideAnnotations) && m.slideAnnotations.every(isSlideAnnotation))) &&
    (m.designAnnotations === undefined || (Array.isArray(m.designAnnotations) && m.designAnnotations.every(isDesignAnnotation))) &&
    (m.designSystemAnnotations === undefined ||
      (Array.isArray(m.designSystemAnnotations) && m.designSystemAnnotations.every(isDesignSystemAnnotation))) &&
    (m.videoAnnotations === undefined || (Array.isArray(m.videoAnnotations) && m.videoAnnotations.every(isVideoAnnotation))) &&
    (m.docsAnnotations === undefined || (Array.isArray(m.docsAnnotations) && m.docsAnnotations.every(isDocsAnnotation)))
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
