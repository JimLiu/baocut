import { TaskFailure } from '@baocut/jobs';
import { RpcError, refOf, type Localized, type MessageRef } from '@baocut/protocol';

/**
 * Runtime 文字（仓库约定 §5）在 runtime-core 里的两个小工具。
 *
 * - `taskFailure`：用文案目录里的一条文字（`Localized`）构造 `TaskFailure`。`TaskFailure` 现在只收字符串，`JobRecord.error`
 *   里记下的是发出时当前语言的文字；引用另挂在 `messageRef` 上，等 `@baocut/jobs` 把它写进 `JobError.messageRef` 后界面就能按
 *   自己的语言重新生成。
 * - `localizedOf`：把一个已有的错误（`RpcError`、带 `messageRef` 的自家错误）当作别的文案的参数：有引用时嵌套引用（读者按
 *   自己的语言展开），没有时就是它的文字（第三方原话、旧错误）。
 */
export function taskFailure(
  code: string,
  message: Localized,
  details?: unknown,
  result: ConstructorParameters<typeof TaskFailure>[3] = null,
): TaskFailure & { messageRef: MessageRef } {
  return Object.assign(new TaskFailure(code, message.text, details, result), { messageRef: refOf(message) });
}

export function localizedOf(error: unknown): Localized | string {
  if (error && typeof error === 'object' && 'message' in error) {
    const { message, messageRef } = error as { message: unknown; messageRef?: MessageRef };
    const text = String(message);
    return messageRef ? { ...messageRef, text, toString: () => text } : text;
  }
  return String(error);
}

/** 用一条文案重新包一个已有的 `RpcError`（例如只收字符串的 `libraryError` 造出来的）：错误码与详情不变，消息带上引用。 */
export function withLocalized(error: RpcError, message: Localized): RpcError {
  return new RpcError(error.code, message, error.details);
}

/** 把一个错误转成另一种错误（例如 `RpcError` → `TaskFailure`）时带上原来的消息引用；原来没有引用时原样返回。 */
export function withMessageRef<T extends Error>(target: T, source: { messageRef?: MessageRef | undefined }): T {
  return source.messageRef ? Object.assign(target, { messageRef: source.messageRef }) : target;
}

/** `JobError` 的 `message` 与 `messageRef`：发出时的语言的文字，连同引用。 */
export function jobMessage(message: Localized): { message: string; messageRef: MessageRef } {
  return { message: message.text, messageRef: refOf(message) };
}

/** 错误 `details` 或状态里的补救说明：`remedy` 文字连同 `remedyRef` 引用。 */
export function remedyOf(remedy: Localized): { remedy: string; remedyRef: MessageRef } {
  return { remedy: remedy.text, remedyRef: refOf(remedy) };
}
