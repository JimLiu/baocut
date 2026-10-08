import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { trimCache } from './cache-limit.ts';

const HOUR = 60 * 60 * 1000;

describe('trimCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-cache-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 写一个 `size` 字节的文件，修改时间是 `hoursAgo` 小时之前。 */
  const put = async (relative: string, size: number, hoursAgo: number) => {
    const file = path.join(dir, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.alloc(size));
    const at = new Date(Date.now() - hoursAgo * HOUR);
    await fs.utimes(file, at, at);
    return file;
  };
  const exists = (file: string) =>
    fs.stat(file).then(
      () => true,
      () => false,
    );

  it('没超上限时什么也不删', async () => {
    await put('media/aa/peaks.bin', 100, 5);
    const result = await trimCache(dir, { maxBytes: 1000 });
    expect(result).toMatchObject({ totalBytes: 100, removed: 0, remainingBytes: 100 });
  });

  it('超过上限：从最旧的删起，降到上限的 90%；内容索引不删', async () => {
    const index = await put('content-index/index.db', 300, 100);
    const wal = await put('content-index/index.db-wal', 50, 100);
    const shm = await put('content-index/index.db-shm', 50, 100);
    const oldest = await put('media/aa/thumb-0.jpg', 200, 50);
    const older = await put('media/playback/x.mp4', 200, 40);
    const newer = await put('media/bb/peaks.bin', 200, 30);
    const newest = await put('media/files/f.jpg', 200, 1);
    // 总共 1200，上限 1000，降到 900：删掉最旧的两个（400）之后是 800。
    const result = await trimCache(dir, { maxBytes: 1000 });
    expect(result).toMatchObject({ totalBytes: 1200, protectedBytes: 400, removed: 2, removedBytes: 400, remainingBytes: 800, failed: 0 });
    for (const file of [index, wal, shm, newer, newest]) expect(await exists(file)).toBe(true);
    for (const file of [oldest, older]) expect(await exists(file)).toBe(false);
  });

  it('正在写的临时文件不删，旧的临时文件照常淘汰；删空的旧目录一并删掉', async () => {
    const inFlight = await put('media/playback/y.mp4.abc.tmp.mp4', 500, 0);
    const stale = await put('media/playback/z.mp4.def.tmp.mp4', 500, 3);
    const thumb = await put('media/cc/thumb-1.jpg', 100, 2);
    const ccDir = path.dirname(thumb);
    const at = new Date(Date.now() - 2 * HOUR);
    await fs.utimes(ccDir, at, at);
    const result = await trimCache(dir, { maxBytes: 600 });
    // 1100 → 目标 540：删掉旧的临时文件（500）与缩略图（100），剩下正在写的 500。
    expect(result).toMatchObject({ removed: 2, remainingBytes: 500 });
    expect(await exists(inFlight)).toBe(true);
    expect(await exists(stale)).toBe(false);
    expect(await exists(ccDir)).toBe(false);
  });

  it('目录不存在时返回空的结果', async () => {
    const result = await trimCache(path.join(dir, 'missing'), { maxBytes: 10 });
    expect(result).toEqual({ totalBytes: 0, protectedBytes: 0, removed: 0, removedBytes: 0, failed: 0, remainingBytes: 0 });
  });
});
