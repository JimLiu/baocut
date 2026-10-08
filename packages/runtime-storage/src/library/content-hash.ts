import crypto from 'node:crypto';

/**
 * 规范 JSON：对象的键按字典序，没有空白；`undefined` 的字段省略。与 `@baocut/jobs` 的同名函数规则相同；
 * 存储层不能依赖 jobs（依赖方向），所以在这里各写一份。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** 条目内容的摘要 `sha256:<hex>`。 */
export function contentHashOf(content: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(content))}`;
}
