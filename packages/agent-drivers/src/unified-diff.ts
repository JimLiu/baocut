import path from 'node:path';

/**
 * 改文件的步骤的 `output` 用的 unified diff（架构设计 §3.1）：Claude 与 ACP 的 Driver 共用的几样。
 */

/** 按行拆开；末尾的换行不多出一个空行。 */
export function diffBodyLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r?\n$/, '').split(/\r?\n/);
}

/** 文件头里的路径：在工作目录里的写相对路径（`a/` / `b/` 前缀）；不在、或没有工作目录时用原路径。 */
export function diffPath(file: string, cwd: string | null): { a: string; b: string } {
  const relative = cwd && path.isAbsolute(file) ? path.relative(cwd, file) : null;
  if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    const posix = relative.split(path.sep).join('/');
    return { a: `a/${posix}`, b: `b/${posix}` };
  }
  if (!path.isAbsolute(file)) return { a: `a/${file}`, b: `b/${file}` };
  return { a: file, b: file };
}

const CONTEXT_LINES = 3;

/**
 * 两段文字之间的 unified diff（一个块）：去掉两头相同的行，前后各留至多 3 行上下文。`oldText` 为 null 表示新建
 * （旧侧 `/dev/null`）。行号相对给出的文字：给的是整个文件时就是文件里的行号；只给了改动片段（有的智能体这样给）时
 * 是片段里的行号。两边相同时为 null。
 */
export function textDiff(file: { a: string; b: string }, oldText: string | null, newText: string): string | null {
  const before = oldText === null ? [] : diffBodyLines(oldText);
  const after = diffBodyLines(newText);
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail])
    tail++;
  if (oldText !== null && head === before.length && head === after.length) return null;
  const start = Math.max(0, head - CONTEXT_LINES);
  const removed = before.slice(head, before.length - tail);
  const added = after.slice(head, after.length - tail);
  const leading = before.slice(start, head);
  const trailing = before.slice(before.length - tail, Math.min(before.length, before.length - tail + CONTEXT_LINES));
  const oldCount = leading.length + removed.length + trailing.length;
  const newCount = leading.length + added.length + trailing.length;
  // unified diff 的约定：某一侧为 0 行时，起始行号写它前面那一行（空文件写 0）。
  const oldStart = oldCount === 0 ? start : start + 1;
  const newStart = newCount === 0 ? start : start + 1;
  return [
    oldText === null ? '--- /dev/null' : `--- ${file.a}`,
    `+++ ${file.b}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...leading.map((l) => ` ${l}`),
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    ...trailing.map((l) => ` ${l}`),
  ].join('\n');
}
