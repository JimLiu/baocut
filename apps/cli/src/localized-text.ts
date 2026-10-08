import { isMessageRef, localizeText, type MessageRef } from '@baocut/protocol';

/**
 * Runtime 存下或发来的文字按 CLI 当前语言重新生成（message-ref.ts、仓库约定 §5）：字段 `foo` 旁边的 `fooRef` 认得出就用它，
 * 否则照用文本。有类型的字段直接 `localizeText(x.detail, x.detailRef)`；这里收口从 `details: unknown` 里取的几种形状。
 */

/** 从未知形状里取一条引用。 */
export function refIn(value: unknown): MessageRef | null {
  return isMessageRef(value) ? value : null;
}

/** 错误 `details` 里字符串形状的补救说明（`remedy` / `remedyRef`）；不是字符串时 null。 */
export function remedyText(details: unknown): string | null {
  const { remedy, remedyRef } = (details ?? {}) as { remedy?: unknown; remedyRef?: unknown };
  return typeof remedy === 'string' ? localizeText(remedy, refIn(remedyRef)) : null;
}

/** 对象形状的补救（`{ hint, hintRef, … }`，授权与能力未配置的拒绝）里的提示；没有时 null。 */
export function remedyHintText(remedy: unknown): string | null {
  const { hint, hintRef } = (remedy ?? {}) as { hint?: unknown; hintRef?: unknown };
  return typeof hint === 'string' ? localizeText(hint, refIn(hintRef)) : null;
}
