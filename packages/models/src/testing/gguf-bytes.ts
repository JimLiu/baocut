/** 造一个只有文件头的 GGUF v3：键值按给的顺序写；值是字符串、数字（uint32）或数组。 */
export function ggufBytes(kv: [string, string | number | { strings: string[] } | { u64: number[] } | { bytes: Buffer }][]): Buffer {
  const parts: Buffer[] = [Buffer.from('GGUF')];
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    parts.push(b);
  };
  const u64 = (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    parts.push(b);
  };
  const str = (s: string) => {
    const b = Buffer.from(s, 'utf8');
    u64(b.length);
    parts.push(b);
  };
  u32(3);
  u64(0);
  u64(kv.length);
  for (const [key, value] of kv) {
    str(key);
    if (typeof value === 'string') {
      u32(8);
      str(value);
    } else if (typeof value === 'number') {
      u32(4);
      u32(value);
    } else if ('strings' in value) {
      u32(9);
      u32(8);
      u64(value.strings.length);
      value.strings.forEach(str);
    } else if ('u64' in value) {
      u32(9);
      u32(10);
      u64(value.u64.length);
      value.u64.forEach(u64);
    } else {
      u32(9);
      u32(0);
      u64(value.bytes.length);
      parts.push(value.bytes);
    }
  }
  return Buffer.concat(parts);
}
