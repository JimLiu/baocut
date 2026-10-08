import type { Id } from './domain.ts';

/** 带前缀的随机 ID，例如 `conv_6f1c…`。浏览器与 Node 都有 `crypto.randomUUID`。 */
export function newId(prefix: string): Id {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
