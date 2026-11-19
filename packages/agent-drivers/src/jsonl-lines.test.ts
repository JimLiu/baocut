import { describe, expect, it } from 'vitest';
import { JsonlLineReader } from './jsonl-lines.ts';

function reader(maxLineChars?: number) {
  const lines: string[] = [];
  const overflows: number[] = [];
  const r = new JsonlLineReader({ onLine: (l) => lines.push(l), onOverflow: (n) => overflows.push(n), maxLineChars });
  return { r, lines, overflows };
}

describe('JsonlLineReader', () => {
  it('只按 LF 分行：U+2028 / U+2029 留在行内', () => {
    const { r, lines } = reader();
    const msg = JSON.stringify({ a: 'x y z' });
    r.push(`${msg}\n`);
    expect(lines).toEqual([msg]);
    expect(JSON.parse(lines[0]!)).toEqual({ a: 'x y z' });
  });

  it('去掉行尾 CR，跳过空行，跨块拼接，最后一段等换行或 end()', () => {
    const { r, lines } = reader();
    r.push('{"a":1}\r\n\n{"b"');
    r.push(':2}\n{"c":3}');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    r.end();
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('Buffer 块里被切开的多字节字符照常解码', () => {
    const { r, lines } = reader();
    const bytes = Buffer.from('{"t":"汉字"}\n', 'utf8');
    for (let i = 0; i < bytes.length; i++) r.push(bytes.subarray(i, i + 1));
    expect(lines).toEqual(['{"t":"汉字"}']);
  });

  it('一行超过上限：报一次，之后的输出全部丢弃', () => {
    const { r, lines, overflows } = reader(10);
    r.push('{"ok":1}\n');
    r.push('0123456');
    r.push('789abc');
    r.push('\n{"later":1}\n');
    expect(lines).toEqual(['{"ok":1}']);
    expect(overflows).toEqual([13]);
  });

  it('一块里的完整长行也按上限算', () => {
    const { r, lines, overflows } = reader(10);
    r.push('{"x":"0123456789"}\n{"y":1}\n');
    expect(lines).toEqual([]);
    expect(overflows).toHaveLength(1);
  });
});
