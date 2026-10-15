/**
 * 文档编辑器页面的宿主（docs/design/docs §5、§8），install.ts 装到页面上：
 *
 * - `docsHost.comments`：编辑器里批注的「Send to agent」先把批注存进文档，再调 `sendToClaude({anchor, text})`。这里向文档服务
 *   要这条批注的位置说明（`api/baocut/annotation`：标签页名、原文），发 `editor:annotate` 给父窗口（BaoCut 界面），
 *   父窗口把它挂到会话草稿上并回 `editor:annotate-result`。
 * - `docsHost.chat`：编辑器左下角的「Ask Agent」请父窗口把焦点交给这个会话的输入框（`editor:focus-chat`）。只在 BaoCut 的
 *   iframe 里装；页面单独打开时没有会话，编辑器不显示这个按钮。
 * - `editor:flush`：发送消息前父窗口要编辑器把改动交给服务端。编辑器的改动经 mux 的 door 调用即时发出（停笔后很快），这里
 *   等一小会儿，再等在途的 door 调用都有了回执，回 `editor:flushed`。
 */
import type { DocsEditorAnnotation, EditorToHostMessage, HostToEditorMessage } from '@baocut/slides/editor-messages';

/** 父窗口的消息通道（`@baocut/slides/editor` 的 windowParentLink 同形）。 */
export interface ParentLink {
  post(message: EditorToHostMessage): void;
  onMessage(listener: (message: HostToEditorMessage) => void): () => void;
}

/** 编辑器给的批注位置（packages/docs-runtime/src/docs-host.ts 的 DocsHostCommentAnchor）。 */
export interface CommentAnchor {
  path: string;
  x: number;
  y: number;
}

export type SendVerdict = 'available' | 'no_session' | 'writers_only' | 'off';

export interface DocsHostComments {
  canSendToClaude(): Promise<SendVerdict>;
  sendToClaude(request: { anchor: CommentAnchor; text: string }): Promise<{ threadId: string }>;
}

/** 编辑器左下角「Ask Agent」用的宿主（packages/docs-runtime/src/docs-host.ts 的 DocsHostChat）。 */
export interface DocsHostChat {
  focus(): void;
}

/** 文档服务对一条批注位置的说明（`api/baocut/annotation`）。 */
export interface AnnotationInfo {
  kind: DocsEditorAnnotation['kind'];
  label: string;
  quote?: string;
}

/** 失败时给编辑器读的错误：`code` 是原平台的错误码（编辑器按它显示）。 */
export class HostError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** 父窗口多久不回 `editor:annotate-result` 就算没加上。 */
const ANNOTATE_TIMEOUT_MS = 10_000;
const TEXT_MAX = 4096;

/** 批注位置去掉字符偏移（`@<起>-<止>`）：标注里只要标签页、正文、块与线程。 */
export function annotationPath(path: string): string {
  return path.replace(/@\d+-\d+(?=;|$)/, '');
}

/** 批注正文：去掉开头提及智能体的 `@Agent`（以前的文档里是 `@Claude`；批注本来就是发给它的）。 */
export function annotationText(text: string): string {
  return text.replace(/^\s*@(?:Claude|Agent)\b[\s⁠]*/i, '').trim().slice(0, TEXT_MAX);
}

export function createCommentsHost(
  link: ParentLink | null,
  describe: (path: string) => Promise<AnnotationInfo>,
  newId: () => string = () => crypto.randomUUID(),
): DocsHostComments {
  const pending = new Map<string, (ok: boolean) => void>();
  link?.onMessage((message) => {
    if (message.type === 'editor:annotate-result') pending.get(message.requestId)?.(message.ok);
  });
  return {
    // 页面单独打开（不在 BaoCut 的 iframe 里）时没有会话可交
    canSendToClaude: async () => (link ? 'available' : 'no_session'),
    async sendToClaude({ anchor, text }) {
      if (!link) throw new HostError('unavailable', 'not inside a BaoCut session');
      const thread = /;thread=([^;]+)$/.exec(anchor.path)?.[1];
      if (!thread) throw new HostError('not_found', 'the comment has no thread');
      const info = await describe(anchor.path).catch(() => {
        throw new HostError('not_found', 'the comment is not in the doc');
      });
      const body = annotationText(text) || info.quote || '';
      if (!body) throw new HostError('upstream_error', 'empty comment');
      const requestId = newId();
      const ok = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => settle(false), ANNOTATE_TIMEOUT_MS);
        const settle = (value: boolean) => {
          clearTimeout(timer);
          pending.delete(requestId);
          resolve(value);
        };
        pending.set(requestId, settle);
        link.post({
          type: 'editor:annotate',
          requestId,
          kind: info.kind,
          path: annotationPath(anchor.path),
          label: info.label,
          ...(info.quote ? { quote: info.quote.slice(0, TEXT_MAX) } : {}),
          text: body,
        });
      });
      if (!ok) throw new HostError('unavailable', 'the session did not take the comment');
      return { threadId: thread };
    },
  };
}

export function createChatHost(link: ParentLink): DocsHostChat {
  return { focus: () => link.post({ type: 'editor:focus-chat' }) };
}

/** 在途的 door 调用：mux 上发出的 `~d:<rid>` 帧，收到同一个 rid 的 `doorack` 为止。 */
export class DoorTracker {
  readonly #inFlight = new Set<number>();
  #waiters: (() => void)[] = [];

  sent(rid: number): void {
    this.#inFlight.add(rid);
  }

  acked(rid: number): void {
    this.#inFlight.delete(rid);
    if (this.#inFlight.size === 0) for (const wake of this.#waiters.splice(0)) wake();
  }

  /** 所有连接都断了：在途的都不会有回执了。 */
  reset(): void {
    this.#inFlight.clear();
    for (const wake of this.#waiters.splice(0)) wake();
  }

  get size(): number {
    return this.#inFlight.size;
  }

  /** 等到没有在途调用；超时返回 false。 */
  idle(timeoutMs: number): Promise<boolean> {
    if (this.#inFlight.size === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#waiters = this.#waiters.filter((wake) => wake !== done);
        resolve(false);
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.#waiters.push(done);
    });
  }
}

/** 解析发出去的二进制帧：door 调用的 rid（不是 door 调用时 undefined）。 */
export function doorRid(data: unknown): number | undefined {
  let bytes: Uint8Array | undefined;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (!bytes || bytes.length < 2) return undefined;
  const length = bytes[0]! | (bytes[1]! << 8);
  const label = new TextDecoder().decode(bytes.subarray(2, 2 + Math.min(length, 64)));
  const match = /^~d:(\d+):/.exec(label);
  return match ? Number(match[1]) : undefined;
}

/** 收到的文本帧：`doorack` 的 rid。 */
export function ackRid(data: unknown): number | undefined {
  if (typeof data !== 'string' || !data.includes('doorack')) return undefined;
  try {
    const frame = JSON.parse(data) as { op?: unknown; rid?: unknown };
    return frame.op === 'doorack' && typeof frame.rid === 'number' ? frame.rid : undefined;
  } catch {
    return undefined;
  }
}

/** 停笔后编辑器多久发出改动：flush 先等这么久，再等在途的调用。 */
const SETTLE_MS = 400;
const FLUSH_TIMEOUT_MS = 8_000;

/** 回应父窗口的 `editor:flush`。 */
export function answerFlush(link: ParentLink, tracker: DoorTracker, settleMs = SETTLE_MS): () => void {
  return link.onMessage((message) => {
    if (message.type !== 'editor:flush') return;
    const { requestId } = message;
    setTimeout(() => {
      void tracker.idle(FLUSH_TIMEOUT_MS).then((saved) => link.post({ type: 'editor:flushed', requestId, saved }));
    }, settleMs);
  });
}
