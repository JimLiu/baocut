import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonlCorruptError, appendJsonl, compactJsonl, quarantineFile, readJsonl } from './jsonl-file.ts';

const HEADER = { op: 'header', formatVersion: 2 };

describe('jsonl-file', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-jsonl-file-'));
    file = path.join(dir, 'store', 'ledger.jsonl');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('不在的文件读出 null；追加时先写文件头，之后只追加', async () => {
    expect(await readJsonl(file)).toBeNull();
    await appendJsonl(file, ['{"a":1}'], { header: HEADER });
    await appendJsonl(file, ['{"a":2}', '{"a":3}'], { header: HEADER });
    expect(await fs.readFile(file, 'utf8')).toBe(`${JSON.stringify(HEADER)}\n{"a":1}\n{"a":2}\n{"a":3}\n`);
    const read = await readJsonl(file);
    expect(read).toMatchObject({ header: HEADER, rows: [{ a: 1 }, { a: 2 }, { a: 3 }], skipped: 0, truncatedTail: false, lines: 3 });
  });

  it('末尾的残行跳过、不算坏行；之后追加先补换行，新行不接在残行后面', async () => {
    await appendJsonl(file, ['{"a":1}'], { header: HEADER });
    await fs.appendFile(file, '{"a":2,"b"');
    expect(await readJsonl(file)).toMatchObject({ rows: [{ a: 1 }], skipped: 0, truncatedTail: true, lines: 2 });
    await appendJsonl(file, ['{"a":3}'], { header: HEADER });
    // 残行成了中间的坏行：跳过并计数，后面的行照读。
    expect(await readJsonl(file)).toMatchObject({ rows: [{ a: 1 }, { a: 3 }], skipped: 1, truncatedTail: false });
  });

  it('第一行认不出时整个文件算坏的；空文件不算', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '');
    expect(await readJsonl(file)).toMatchObject({ header: null, rows: [], lines: 0 });
    await fs.writeFile(file, 'not json\n{"a":1}\n');
    await expect(readJsonl(file)).rejects.toBeInstanceOf(JsonlCorruptError);
    const kept = await quarantineFile(file);
    expect(path.basename(kept)).toMatch(/^ledger\.jsonl\.corrupt-\d+$/);
    expect(await readJsonl(file)).toBeNull();
  });

  it('压缩：原子替换成文件头加这些行，不留临时文件', async () => {
    await appendJsonl(file, ['{"a":1}', '{"a":2}'], { header: HEADER });
    const bytes = await compactJsonl(file, ['{"a":9}'], { header: HEADER });
    const text = await fs.readFile(file, 'utf8');
    expect(text).toBe(`${JSON.stringify(HEADER)}\n{"a":9}\n`);
    expect(bytes).toBe(Buffer.byteLength(text));
    expect(await fs.readdir(path.dirname(file))).toEqual(['ledger.jsonl']);
  });
});
