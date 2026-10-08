/**
 * 查找与替换的匹配器（照原型 `model-find.js`）：区分大小写、全词、正则三个开关只有这一份实现，
 * 字幕列表与以后的文稿共用。区间是 UTF-16 偏移（`String.slice` 的口径）。
 */

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface TextRange {
  start: number;
  end: number;
}

const RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;
/** 词边界用 Unicode 属性类：`\b` 只认 ASCII，中文的「全词」会在每个字之间都判成边界。 */
const NOT_WORD = '[^\\p{L}\\p{N}]';

/** 编译一次：`{re}` 或 `{error}`（正则写错了要说出来，不是安静地查不到）。查询为空时两者皆无。 */
export function compileFind(query: string, options: FindOptions): { re?: RegExp; error?: string } {
  if (!query) return {};
  let source = options.regex ? query : query.replace(RE_ESCAPE, '\\$&');
  if (options.wholeWord) source = `(?:^|${NOT_WORD})(${source})(?=$|${NOT_WORD})`;
  try {
    return { re: new RegExp(source, `g${options.matchCase ? '' : 'i'}u`) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** 一段文本里的全部命中。 */
export function findRanges(text: string, re: RegExp, wholeWord: boolean): TextRange[] {
  const out: TextRange[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    // 全词模式把命中包在第 1 组里，外面那圈是边界。
    const grouped = wholeWord && match[1] !== undefined;
    const hit = grouped ? match[1]! : match[0];
    const start = grouped ? match.index + match[0].indexOf(hit) : match.index;
    if (!hit.length) {
      re.lastIndex++;
      continue;
    }
    out.push({ start, end: start + hit.length });
    if (re.lastIndex <= start) re.lastIndex = start + hit.length;
  }
  return out;
}

/** 在一段文本里落下若干替换（从后往前改，前面的区间才不挪位）。替换文本按字面插入，不解析 `$1`。 */
export function replaceRanges(text: string, ranges: readonly TextRange[], replacement: string): { text: string; changed: number } {
  let next = text;
  let changed = 0;
  for (const range of [...ranges].sort((a, b) => b.start - a.start)) {
    if (range.start < 0 || range.end < range.start || range.end > next.length) continue;
    if (next.slice(range.start, range.end) !== replacement) changed++;
    next = next.slice(0, range.start) + replacement + next.slice(range.end);
  }
  return { text: next, changed };
}

/** 上一个 / 下一个，到头绕回去。 */
export function stepIndex(index: number, length: number, direction: 1 | -1): number {
  if (!length) return 0;
  const at = Math.min(Math.max(0, index), length - 1);
  return (((at + direction) % length) + length) % length;
}
