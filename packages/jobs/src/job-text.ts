import { refOf, type JobError, type JobWarning, type Localized, type MessageRef } from '@baocut/protocol';
import { JobsCommon } from '@baocut/protocol/messages/jobs/common.ts';

/**
 * 任务里给人看的文字（仓库约定 §5）：目录生成的 `Localized`（文本 + 消息引用），或照原样的字符串（第三方原话、旧记录）。
 * 存进 `JobRecord` 的字段 `foo` 旁边带上 `fooRef`，界面按自己的语言重新生成。
 */
export type JobText = string | Localized;

/** 步骤名这类在用的时候才生成的文字：字符串照用，函数每次调用时按当前语言生成。 */
export type LazyText = string | (() => Localized);

export function resolveText(text: LazyText): JobText {
  return typeof text === 'function' ? text() : text;
}

/** 文本与它的引用（字符串没有引用）。 */
export function textParts(text: JobText): { text: string; ref: MessageRef | undefined } {
  return typeof text === 'string' ? { text, ref: undefined } : { text: text.text, ref: refOf(text) };
}

/** 错误带着的消息引用：`RpcError`、`PipelineStepError` 这些用目录文字构造的错误有 `messageRef`。 */
export function errorRef(error: unknown): MessageRef | undefined {
  const ref = error && typeof error === 'object' ? (error as { messageRef?: unknown }).messageRef : undefined;
  return ref && typeof ref === 'object' && typeof (ref as MessageRef).key === 'string' ? (ref as MessageRef) : undefined;
}

/** 错误的文字，有引用时连同引用一起（可以作为别的目录条目的参数嵌进去）。 */
export function errorText(error: unknown): JobText {
  const message = error instanceof Error ? error.message : String(error);
  const ref = errorRef(error);
  return ref ? asLocalized(message, ref) : message;
}

/** 已经生成的文本与引用重新包成 `Localized`（嵌进别的条目时用）；没有引用时就是文本。 */
export function asLocalized(text: string, ref: MessageRef | undefined): JobText {
  return ref ? { ...ref, text, toString: () => text } : text;
}

/** 任务错误：`message` 与它的引用一起记下。 */
export function jobError(code: string, message: JobText, details?: unknown): JobError {
  const { text, ref } = textParts(message);
  return { code, message: text, ...(ref ? { messageRef: ref } : {}), ...(details === undefined ? {} : { details }) };
}

/** 结构化警告：`detail` 与它的引用一起记下。 */
export function jobWarning(code: string, detail: JobText, extra: Omit<JobWarning, 'code' | 'detail' | 'detailRef'> = {}): JobWarning {
  const { text, ref } = textParts(detail);
  return { code, ...extra, detail: text, ...(ref ? { detailRef: ref } : {}) };
}

/** 「说明：原因」：原因是另一个错误时带上它的引用。 */
export function withCause(message: JobText, cause: unknown): Localized {
  return JobsCommon.withCause({ message, cause: errorText(cause) });
}

/** 按当前语言把几个 ID、名字连成一串。 */
export function joinList(items: readonly string[]): string {
  return items.join(JobsCommon.listSeparator().text);
}

/** 带消息引用的错误：构造时给 `Localized` 就记下引用。供包里的错误类继承。 */
export class LocalizedError extends Error {
  readonly messageRef: MessageRef | undefined;

  constructor(message: JobText) {
    super(String(message));
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
  }
}
