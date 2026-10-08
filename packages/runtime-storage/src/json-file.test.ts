import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJson, writeJsonAtomic } from './json-file.ts';

describe('writeJsonAtomic', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-json-file-'));
  });

  afterEach(async () => {
    await fs.chmod(path.join(dir, 'store'), 0o700).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('durable：写完、同步之后改名，权限照给的；不留临时文件；后写的覆盖先写的', async () => {
    const file = path.join(dir, 'store', 'jobs.json');
    await writeJsonAtomic(file, { n: 1 }, { durable: true, mode: 0o600 });
    await writeJsonAtomic(file, { n: 2 }, { durable: true, mode: 0o600 });
    expect(await readJson(file)).toEqual({ n: 2 });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(path.dirname(file))).toEqual(['jobs.json']);
  });

  it('durable：写不进去时抛出，原来的文件不动', async () => {
    const file = path.join(dir, 'store', 'jobs.json');
    await writeJsonAtomic(file, { n: 1 }, { durable: true });
    await fs.chmod(path.dirname(file), 0o500);
    await expect(writeJsonAtomic(file, { n: 2 }, { durable: true })).rejects.toThrow();
    await fs.chmod(path.dirname(file), 0o700);
    expect(await readJson(file)).toEqual({ n: 1 });
    expect(await fs.readdir(path.dirname(file))).toEqual(['jobs.json']);
  });
});
