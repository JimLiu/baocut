import type { Seq } from './domain.ts';

/** 序号在线上是十进制字符串（D06），比较与递增走 BigInt。 */
export const ZERO_SEQ: Seq = '0';

export function nextSeq(seq: Seq): Seq {
  return (BigInt(seq) + 1n).toString();
}

export function compareSeq(a: Seq, b: Seq): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

export function isNextSeq(prev: Seq, next: Seq): boolean {
  return BigInt(next) === BigInt(prev) + 1n;
}
