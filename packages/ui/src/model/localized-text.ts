import { isMessageRef, localizeText, type MessageRef } from '@baocut/protocol';

/**
 * Runtime 存下的文字在显示时按界面当前语言重新生成（message-ref.ts、仓库约定 §5）：字段 `foo` 旁边的 `fooRef` 认得出就用它，
 * 否则照用文本。这里收口几种常见形状；有类型的字段直接 `localizeText(x.detail, x.detailRef)`。
 */

/** 从 `details: unknown` 这类未知形状里取一条引用。 */
export function refIn(value: unknown): MessageRef | null {
  return isMessageRef(value) ? value : null;
}

/** 任务的错误（`JobError` 的 `message` / `messageRef`）。 */
export function jobErrorText(error: { message: string; messageRef?: MessageRef }): string;
export function jobErrorText(error: { message: string; messageRef?: MessageRef } | null | undefined): string | null;
export function jobErrorText(error: { message: string; messageRef?: MessageRef } | null | undefined): string | null {
  return error ? localizeText(error.message, error.messageRef) : null;
}

/** 排队时在等什么（`JobRecord.wait` / 资源快照里等待者的 `wait`：`detail` / `detailRef`）；没有时 null。 */
export function jobWaitText(wait: { detail: string; detailRef?: MessageRef } | null | undefined): string | null {
  return wait ? localizeText(wait.detail, wait.detailRef) : null;
}

/** 错误 `details` 里字符串形状的补救说明（`remedy` / `remedyRef`）；不是字符串或为空时 null。 */
export function remedyText(details: unknown): string | null {
  const { remedy, remedyRef } = (details ?? {}) as { remedy?: unknown; remedyRef?: unknown };
  return typeof remedy === 'string' && remedy ? localizeText(remedy, refIn(remedyRef)) : null;
}

/** 对象形状的补救（`{ hint, hintRef, … }`，授权与能力未配置的拒绝）里的提示；没有或为空时 null。 */
export function remedyHintText(remedy: unknown): string | null {
  const { hint, hintRef } = (remedy ?? {}) as { hint?: unknown; hintRef?: unknown };
  return typeof hint === 'string' && hint ? localizeText(hint, refIn(hintRef)) : null;
}
