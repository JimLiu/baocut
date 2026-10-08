import type { TranscriptionGlossary } from '@baocut/protocol';

/** 识别提示的上限，与 `models.transcribe` 的 `hint` 相同。 */
export const TRANSCRIBE_HINT_MAX_CHARS = 1200;

/**
 * 把识别用术语表的规范写法接在用户的提示之后（架构设计 §5.9）：按术语表的顺序、去重，用「、」连接，
 * 整体不超过上限；放不下的舍去并计数。用户的提示原样在前，不被截断。
 */
export function composeTranscribeHint(
  userHint: string | undefined,
  glossaries: readonly TranscriptionGlossary[],
  max = TRANSCRIBE_HINT_MAX_CHARS,
): { hint: string | undefined; terms: number; dropped: number } {
  const seen = new Set<string>();
  const canonical: string[] = [];
  for (const g of glossaries) {
    for (const t of g.terms) {
      if (seen.has(t.canonical)) continue;
      seen.add(t.canonical);
      canonical.push(t.canonical);
    }
  }
  const base = userHint?.trim() ?? '';
  let hint = base;
  let terms = 0;
  for (const term of canonical) {
    // i18n-ignore: 交给转写模型的提示词，按术语原文的习惯分隔，不随界面语言变化
    const next = hint ? (terms === 0 ? `${hint}\n${term}` : `${hint}、${term}`) : term;
    if ([...next].length > max) break;
    hint = next;
    terms++;
  }
  return { hint: hint || undefined, terms, dropped: canonical.length - terms };
}
